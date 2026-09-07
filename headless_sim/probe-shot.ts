// シュートの腕の動きを測る。体幹→肩→肘→手首の順に動いているか、
// フォロースルーの終わりが急停止していないか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Quaternion, Vector3 } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = false;
import { clubTeam } from "../src/roster";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;

type BN = Parameters<NonNullable<Player["vox"]>["rig"]["node"]>[0];
const TRACK = ["Spine", "UpperArm", "LowerArm", "Hand"] as const;
/** 1本の腕ぶんの、フレームごとの角速度(deg/s)。 */
type Take = { name: string; spd: Record<string, number[]>; rel: number; end: number; hand: number[] };
const takes: Take[] = [];

// ⚠️ 局所回転で測ってはいけない。肩の開き補正(splayArm)の打ち消しが前腕の局所回転に
//    折り込まれるので、見た目が連続でも局所では跳ねて見える（実測 1660°/s）。
//    画面で見えるのはワールドでの向きなので、そちらを測る。
const _sc = new Vector3(), _tr = new Vector3(), _rq = new Quaternion();
/** 骨のワールド向きから**体の向き**を割り戻したもの。
  ⚠️ 素のワールド向きだと選手が向きを変えたぶんが全部乗ってしまい、腕の動きと
     区別できない（実測で終わり際が4部位そろって 615°/s になった）。 */
function worldQ(p: Player, bone: string, out: Quaternion): Quaternion | null {
  const n = p.vox?.rig.node(bone as BN);
  const rt = p.vox?.root;
  if (!n || !rt) return null;
  n.computeWorldMatrix(true); rt.computeWorldMatrix(true);
  n.getWorldMatrix().decompose(_sc, out, _tr);
  rt.getWorldMatrix().decompose(_sc, _rq, _tr);
  _rq.conjugateInPlace();
  _rq.multiplyToRef(out, out);
  return out;
}
const _a = new Quaternion(), _b = new Quaternion();

for (let gi = 0; gi < 3; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 3);
  g.applyRoster(); g.reset();
  let cur: Take | null = null;
  let side = "Left";
  const prev = new Map<string, Quaternion>();
  for (let i = 0; i < 60 * 60 * 3; i++) {
    game.update(DT);
    const sh = game.shooter ?? game.chargeShooter;
    const charging = game.ballMode === "charge" && game.chargeShooter;
    const active = charging || (sh && (game.ballMode === "shot" || sh.coolT > 0));
    if (active && sh) {
      if (!cur) {
        // 利き手側の骨を決める（両腕を見て、動きの大きい方を後で選ぶ）
        side = (sh.hand === "R") === (sh.numberSide > 0) ? "Left" : "Right";
        cur = { name: sh.name, spd: {}, rel: -1, end: -1, hand: [] };
        for (const t of TRACK) cur.spd[t] = [];
        prev.clear();
      }
      for (const t of TRACK) {
        const bone = t === "Spine" ? "Spine" : side + t;
        if (!worldQ(sh, bone, _a)) continue;
        const pq = prev.get(t);
        if (pq) {
          const d = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(pq, _a))));
          cur.spd[t].push(d / DT * 180 / Math.PI);
        } else cur.spd[t].push(0);
        prev.set(t, _a.clone());
      }
      // 利き手とボールの距離（手が早くボールから離れていないか）
      {
        const hn = sh.vox?.rig.node((side + "Hand") as BN);
        if (hn) {
          hn.computeWorldMatrix(true);
          const hp = hn.getAbsolutePosition();
          cur.hand.push(Math.hypot(hp.x - game.ball.pos.x, hp.y - game.ball.pos.y, hp.z - game.ball.pos.z));
        } else cur.hand.push(-1);
      }
      if (game.ballMode === "shot" && cur.rel < 0) cur.rel = cur.spd.Spine.length;
    } else if (cur) {
      cur.end = cur.spd.Spine.length;
      if (cur.rel > 0 && cur.spd.Spine.length > 30) takes.push(cur);
      cur = null;
    }
    void _b;
  }
}

const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(0) : "-";
console.log(`シュート ${takes.length} 本を計測`);
// ① 動き出しの順番: リリース前後で角速度が最初に 30°/s を超えたフレーム
console.log("\n① 動き出しの順番（リリースを 0 とした秒。小さいほど先に動く）");
for (const t of TRACK) {
  const firsts: number[] = [];
  for (const tk of takes) {
    const a = tk.spd[t];
    let hit = -1;
    for (let i = Math.max(0, tk.rel - 20); i < a.length; i++) if (a[i] > 30) { hit = i; break; }
    if (hit >= 0) firsts.push((hit - tk.rel) * DT);
  }
  firsts.sort((x, y) => x - y);
  console.log(`  ${t.padEnd(9)} 中央 ${firsts.length ? firsts[firsts.length >> 1].toFixed(3) : "-"}秒`
    + `（${firsts.length}/${takes.length} 本で検出）`);
}
// ② 一番速く動いた瞬間の順番
console.log("\n② 一番速く動いた瞬間（リリースを 0 とした秒）");
for (const t of TRACK) {
  const peaks: number[] = [];
  for (const tk of takes) {
    const a = tk.spd[t];
    let bi = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
    peaks.push((bi - tk.rel) * DT);
  }
  peaks.sort((x, y) => x - y);
  console.log(`  ${t.padEnd(9)} 中央 ${peaks[peaks.length >> 1].toFixed(3)}秒`
    + `  最大角速度 中央 ${q(takes.map((tk) => Math.max(...tk.spd[t])), .5)}°/s`);
}
// ②b リリースの区間だけ、区間ごとに一番速く動いた瞬間
const windows: [string, number, number][] = [
  ["リリース(-0.15〜+0.25秒)", -0.15, 0.25],
  ["振り下ろし(+0.25秒〜終わり)", 0.25, 99],
];
for (const [label, w0, w1] of windows) {
  console.log("");
  console.log("②b " + label + " で一番速く動いた瞬間");
  for (const t of TRACK) {
    const peaks: number[] = [], vals: number[] = [];
    for (const tk of takes) {
      const a2 = tk.spd[t];
      const lo = Math.max(0, tk.rel + Math.round(w0 / DT));
      const hi = Math.min(a2.length, tk.rel + Math.round(w1 / DT));
      let bi = -1;
      for (let i = lo; i < hi; i++) if (bi < 0 || a2[i] > a2[bi]) bi = i;
      if (bi < 0) continue;
      peaks.push((bi - tk.rel) * DT); vals.push(a2[bi]);
    }
    peaks.sort((x, y) => x - y); vals.sort((x, y) => x - y);
    console.log(`  ${t.padEnd(9)} 中央 ${(peaks[peaks.length >> 1] ?? 0).toFixed(3)}秒`
      + `  そのときの角速度 中央 ${(vals[vals.length >> 1] ?? 0).toFixed(0)}°/s`);
  }
}
// ③ 終わり方: フォロースルーが切れる直前の角速度
console.log("\n③ フォロースルーが終わる直前の角速度（0 に近いほど自然に止まっている）");
for (const t of TRACK) {
  const last: number[] = [];
  for (const tk of takes) {
    const a = tk.spd[t];
    const i = a.length - 2;
    if (i > 0) last.push(a[i]);
  }
  console.log(`  ${t.padEnd(9)} 中央 ${q(last, .5)}°/s  75% ${q(last, .75)}°/s  最大 ${q(last, .99)}°/s`);
}
console.log(`\nフォロースルーの長さ 中央 ${(takes.map((t) => (t.end - t.rel) * DT).sort((a, b) => a - b)[takes.length >> 1] ?? 0).toFixed(2)}秒`);

// ④ 利き手とボールの距離（リリース前後）
console.log("");
console.log("④ 利き手の骨とボールの距離（手が早く離れていないか）");
for (const off of [-0.20, -0.10, -0.03, 0, 0.05]) {
  const v: number[] = [];
  for (const tk of takes) {
    const i = tk.rel + Math.round(off / DT);
    if (i >= 0 && i < tk.hand.length && tk.hand[i] >= 0) v.push(tk.hand[i]);
  }
  v.sort((x, y) => x - y);
  console.log(`  リリースの ${off >= 0 ? "+" : ""}${off.toFixed(2)}秒: 中央 ${(v[v.length >> 1] ?? 0).toFixed(3)}m（${v.length} 本）`);
}