// ジャンプ中に脚が動いているか。滞空フレームごとの脚の関節の変化量を測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Quaternion } from "@babylonjs/core";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
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
const LEGS = ["LeftUpperLeg", "LeftLowerLeg", "RightUpperLeg", "RightLowerLeg"] as const;
const DEG = 180 / Math.PI;

const clipUse = new Map<string, number>();
const moveDeg: number[] = [];      // 滞空中の1フレームあたりの脚の動き（4関節の合計、度）
const totalDeg: number[] = [];     // 1回の滞空ぜんぶでの合計
const frozen: number[] = [];       // 滞空フレームのうち「ほぼ動いていない」割合
const _q = new Quaternion();
// 滞空の進み具合ごとの膝の角度、着地後の膝の角度
const airKnee: number[][] = [[], [], [], [], []];
const landKnee: number[][] = [[], [], [], []];
const kneeRange: number[] = [];
const lrKnee: number[] = [];
const lrHip: number[] = [];
const kneeAcc = new Map<Player, { lo: number; hi: number }>();
const landAcc = new Map<Player, number>();
function legQ(p: Player, b: string): Quaternion | null {
  const n = p.vox?.rig.node(b as BN);
  if (!n) return null;
  if (n.rotationQuaternion) _q.copyFrom(n.rotationQuaternion);
  else Quaternion.FromEulerAnglesToRef(n.rotation.x, n.rotation.y, n.rotation.z, _q);
  return _q;
}
for (let gi = 0; gi < 3; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 3);
  g.applyRoster(); g.reset();
  const prev = new Map<Player, Quaternion[]>();
  const acc = new Map<Player, { sum: number; n: number; still: number }>();
  for (let i = 0; i < 60 * 60 * 3; i++) {
    game.update(DT);
    for (const p of game.players) {
      if (!p.vox) continue;
      if (!p.airborne) {
        const a = acc.get(p);
        if (a && a.n > 4) {
          totalDeg.push(a.sum); frozen.push(a.still / a.n);
          const r = kneeAcc.get(p); if (r && r.hi > -900) kneeRange.push(r.hi - r.lo);
          landAcc.set(p, 0);
        }
        kneeAcc.delete(p);
        // 着地後の膝
        const lt = landAcc.get(p);
        if (lt !== undefined) {
          const q3 = legQ(p, "LeftLowerLeg");
          if (q3) {
            const a2 = 2 * Math.acos(Math.min(1, Math.abs(q3.w))) * DEG;
            const slot = Math.floor(lt / 0.15);
            if (slot < 4) landKnee[slot].push(a2);
          }
          if (lt > 0.6) landAcc.delete(p); else landAcc.set(p, lt + DT);
        }
        acc.delete(p); prev.delete(p);
        continue;
      }
      clipUse.set(p.clipName || "(クリップなし)", (clipUse.get(p.clipName || "(クリップなし)") ?? 0) + 1);
      // 滞空の進み具合 k に応じて膝の角度を控える
      {
        const k = p.jumpDur > 0 ? Math.min(1, Math.max(0, 1 - p.jumpRemaining / p.jumpDur)) : 0;
        const q2 = legQ(p, "LeftLowerLeg");
        if (q2) {
          const a = 2 * Math.acos(Math.min(1, Math.abs(q2.w))) * DEG;
          const slot = Math.min(4, Math.floor(k * 5));
          airKnee[slot].push(a);
          const qr = legQ(p, "RightLowerLeg");
          if (qr) lrKnee.push(Math.abs(a - 2 * Math.acos(Math.min(1, Math.abs(qr.w))) * DEG));
          const qhl = legQ(p, "LeftUpperLeg");
          const al = qhl ? 2 * Math.acos(Math.min(1, Math.abs(qhl.w))) * DEG : 0;
          const qhr = legQ(p, "RightUpperLeg");
          if (qhl && qhr) lrHip.push(Math.abs(al - 2 * Math.acos(Math.min(1, Math.abs(qhr.w))) * DEG));
          const r = kneeAcc.get(p) ?? { lo: 999, hi: -999 };
          r.lo = Math.min(r.lo, a); r.hi = Math.max(r.hi, a); kneeAcc.set(p, r);
        }
      }
      const cur: Quaternion[] = [];
      for (const b of LEGS) { const q = legQ(p, b); cur.push(q ? q.clone() : Quaternion.Identity()); }
      const pv = prev.get(p);
      if (pv) {
        let d = 0;
        for (let k = 0; k < LEGS.length; k++) {
          d += 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(pv[k], cur[k])))) * DEG;
        }
        moveDeg.push(d);
        const a = acc.get(p) ?? { sum: 0, n: 0, still: 0 };
        a.sum += d; a.n++; if (d < 0.5) a.still++;
        acc.set(p, a);
      }
      prev.set(p, cur);
    }
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`滞空フレーム ${moveDeg.length}（3試合）`);
console.log(`\n滞空中に使われたクリップ`);
for (const [k, v] of [...clipUse].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14, "　")} ${v} フレーム`);
}
console.log(`\n1フレームあたりの脚の動き（腿・脛×左右の合計、度）`);
console.log(`  中央 ${q(moveDeg, .5)}°  75% ${q(moveDeg, .75)}°  95% ${q(moveDeg, .95)}°`);
console.log(`ジャンプ1回ぜんぶでの合計 中央 ${q(totalDeg, .5)}°（${totalDeg.length} 回）`);
console.log(`滞空フレームのうち「ほぼ動いていない(0.5°未満)」割合 中央 ${(Number(q(frozen, .5)) * 100).toFixed(0)}%`);

const med = (a: number[]): string => a.length
  ? [...a].sort((x, y) => x - y)[a.length >> 1].toFixed(1) : "-";
console.log("");
console.log("滞空の進み具合ごとの膝の角度（左脛。0%=踏み切り 100%=着地）");
console.log(`  0-20%: ${med(airKnee[0])}°  20-40%: ${med(airKnee[1])}°  40-60%: ${med(airKnee[2])}°`
  + `  60-80%: ${med(airKnee[3])}°  80-100%: ${med(airKnee[4])}°`);
console.log(`1回の滞空での膝の角度の振れ幅 中央 ${med(kneeRange)}°（${kneeRange.length} 回）`);
console.log("");
console.log("着地してからの膝の角度（0.15秒ごと）");
console.log(`  0-0.15秒: ${med(landKnee[0])}°  0.15-0.3秒: ${med(landKnee[1])}°`
  + `  0.3-0.45秒: ${med(landKnee[2])}°  0.45-0.6秒: ${med(landKnee[3])}°`);
console.log("");
console.log();
console.log();
const p75 = (a: number[]): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.75)].toFixed(1) : "-";
console.log("");
console.log("左右の脚の差（滞空中。0 に近いほど左右そっくり）");
console.log(`  膝 中央 ${med(lrKnee)}°  75% ${p75(lrKnee)}°`);
console.log(`  腿 中央 ${med(lrHip)}°  75% ${p75(lrHip)}°`);