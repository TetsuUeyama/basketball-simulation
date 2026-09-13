// 「一線を越えられずその場で走り続ける」現象の原因を探す。
// ⚠️ curSpd は**クランプ後**の実移動から出ている（tickMotion は移動と衝突を解いた後に呼ぶ）ので、
//    「脚が回っているのに動けていない」では捕まえられない。位置に残る**指紋**を数える。
//    ・ハンドラーのオーバー&バック止め … pos.z が ちょうど 0.05*s
//    ・コート外れ止め(clampCourt)      … |x| がちょうど halfW-margin、|z| が halfL-margin
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { COURT } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);

const MW = COURT.halfW - COURT.margin, ML = COURT.halfL - COURT.margin;
type Run = { n: number; mode: string; front: boolean; held: boolean; x: number; z: number };
const runs: Record<string, Run[]> = { half: [], side: [], base: [] };
const cur = new Map<Player, Record<string, Run | null>>();
type Win = { x: number[]; z: number[]; v: number[]; flip: number[]; run: number;
  snap: { z: number; s: number; mode: string; held: boolean; x: number; v: number;
    near: number; sameTeam: boolean } | null };
const win = new Map<Player, Win>();
const inPlace: { n: number; z: number; s: number; mode: string; held: boolean; x: number;
  v: number; near: number; sameTeam: boolean; flip: number;
  def: boolean; zd: number; big: boolean; man: number }[] = [];
let frames = 0, poss = 0, lastMode = "";

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  cur.clear(); win.clear();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    frames++;
    if (game.ballMode !== lastMode) { lastMode = game.ballMode; if (lastMode === "throwin") poss++; }
    for (const p of game.players) {
      const s = game.attackSign(p.team);
      const hit: Record<string, boolean> = {
        half: Math.abs(p.pos.z * s - 0.05) < 1e-9,
        side: Math.abs(Math.abs(p.pos.x) - MW) < 1e-9,
        base: Math.abs(Math.abs(p.pos.z) - ML) < 1e-9,
      };
      // 走っているのに進まない判定用の履歴
      let w = win.get(p);
      if (!w) { w = { x: [], z: [], v: [], flip: [], run: 0, snap: null }; win.set(p, w); }
      w.x.push(p.pos.x); w.z.push(p.pos.z); w.v.push(p.curSpd);
      if (w.x.length > 90) { w.x.shift(); w.z.shift(); w.v.shift(); }
      // ⚠️ 進行方向が毎フレーム反転しているか（＝目標が行ったり来たりしている）。
      if (w.x.length >= 3) {
        const n2 = w.x.length;
        const ax = w.x[n2 - 2] - w.x[n2 - 3], az = w.z[n2 - 2] - w.z[n2 - 3];
        const bx = w.x[n2 - 1] - w.x[n2 - 2], bz = w.z[n2 - 1] - w.z[n2 - 2];
        if (Math.hypot(ax, az) > 1e-4 && Math.hypot(bx, bz) > 1e-4) {
          w.flip.push((ax * bx + az * bz) < 0 ? 1 : 0);
          if (w.flip.length > 90) w.flip.shift();
        }
      }
      if (w.x.length === 90) {
        const net = Math.hypot(w.x[89] - w.x[0], w.z[89] - w.z[0]);
        const span = Math.hypot(Math.max(...w.x) - Math.min(...w.x), Math.max(...w.z) - Math.min(...w.z));
        const avgV = w.v.reduce((a2, b2) => a2 + b2, 0) / w.v.length;
        if (net < 0.4 && span < 1.0 && avgV > 1.0) {
          w.run++;
          // ⚠️ 「見えない線」の正体を確かめる: そのとき一番近い選手との距離と、
          //    その相手が自分と目標の**間**にいるか。押し離し(BODY_MIN_DIST=0.62)なら
          //    距離はほぼ 0.62 に張り付く。
          let near = Infinity, sameTeam = false;
          for (const q of game.players) {
            if (q === p) continue;
            const d2 = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
            if (d2 < near) { near = d2; sameTeam = q.team === p.team; }
          }
          // ⚠️ getBackOnDefense の分かれ目は「守備側から見て z*s < 0.5」。
          //    そこをまたいで行ったり来たりしているかを直接見る。
          const sd = game.attackSign(game.possession);
          const zd = p.pos.z * sd;                      // 守備の自陣が +
          w.snap = { z: p.pos.z, s, mode: game.ballMode, held: game.handler === p,
            x: p.pos.x, v: avgV, near, sameTeam,
            def: p.team !== game.possession, zd, big: game.isBig(p),
            // ⚠️ getBackOnDefense の stranded は「担当から 5m 超」で切り替わる。
            //    そこが境目なら、張り付いた瞬間の担当との距離は 5.0m 付近に溜まるはず。
            man: (() => { const o2 = game.teamPlayers(game.possession)[p.slot];
              return o2 ? Math.hypot(o2.pos.x - p.pos.x, o2.pos.z - p.pos.z) : -1; })(),
            flip: w.flip.length ? w.flip.reduce((a2, b2) => a2 + b2, 0) / w.flip.length : 0 };
        } else {
          if (w.run >= 30 && w.snap) inPlace.push({ n: w.run, ...w.snap });
          w.run = 0; w.snap = null;
        }
      }
      let c = cur.get(p);
      if (!c) { c = { half: null, side: null, base: null }; cur.set(p, c); }
      for (const k of ["half", "side", "base"]) {
        if (hit[k]) {
          if (!c[k]) {
            c[k] = { n: 0, mode: game.ballMode, front: game.frontT, held: game.handler === p,
              x: p.pos.x, z: p.pos.z };
          }
          c[k]!.n++;
        } else if (c[k]) {
          if (c[k]!.n >= 15) runs[k].push(c[k]!);     // 0.25秒以上 張り付いた
          c[k] = null;
        }
      }
    }
  }
}
console.log(NG + "試合 / " + frames + "フレーム / スローイン " + poss + "回");
const show = (k: string, label: string): void => {
  const a = runs[k];
  if (!a.length) { console.log(label + ": 0回"); return; }
  const sorted = [...a].sort((x, y) => y.n - x.n);
  const total = a.reduce((s2, r) => s2 + r.n, 0);
  console.log(label + ": " + a.length + "回 / のべ " + (total / 60).toFixed(1) + "秒"
    + " / 1回あたり 中央 " + (sorted[Math.floor(sorted.length / 2)].n / 60).toFixed(2)
    + "秒・最長 " + (sorted[0].n / 60).toFixed(2) + "秒");
  const bins = new Map<string, number>();
  for (const r of a) {
    const key = r.mode + " front" + (r.front ? "○" : "×") + " 保持" + (r.held ? "○" : "×");
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  for (const [kk, n] of [...bins].sort((x, y) => y[1] - x[1]).slice(0, 6)) {
    console.log("    " + n + "回  " + kk);
  }
  console.log("    長いもの5件: " + sorted.slice(0, 5)
    .map((r) => (r.n / 60).toFixed(2) + "秒(x" + r.x.toFixed(1) + " z" + r.z.toFixed(2) + " " + r.mode + ")").join(" / "));
};
// --- 症状そのもの: 脚は回っているのに進んでいない -------------------------
// ⚠️ クランプの指紋に頼らずに測る。1.5秒の正味の移動が 0.4m 未満なのに、その間の
//    平均 curSpd が 1.0m/s を超える＝走っているのに同じ所にいる。
show("half", "ハーフラインに張り付き(pos.z = 0.05*s)");
show("side", "サイドラインに張り付き");
show("base", "エンドラインに張り付き");

console.log("\n走っているのに進んでいない（1.5秒の正味移動 <0.4m / 平均 1.0m/s 超）: "
  + inPlace.length + "回");
if (inPlace.length) {
  const sorted = [...inPlace].sort((a, b) => b.n - a.n);
  console.log("  長さ 中央 " + (sorted[Math.floor(sorted.length / 2)].n / 60).toFixed(2)
    + "秒 / 最長 " + (sorted[0].n / 60).toFixed(2) + "秒");
  const bins = new Map<string, number>();
  for (const r of inPlace) {
    const zone = Math.abs(r.z) < 2 ? "センター付近(|z|<2)"
      : Math.abs(r.z) < 7 ? "中間(2〜7)" : "ゴール寄り(7〜)";
    bins.set(zone + " " + r.mode + (r.held ? " 保持" : ""), (bins.get(zone + " " + r.mode + (r.held ? " 保持" : "")) ?? 0) + 1);
  }
  for (const [k, n] of [...bins].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log("    " + n + "回  " + k);
  console.log("  長いもの5件: " + sorted.slice(0, 5).map((r) =>
    (r.n / 60).toFixed(2) + "秒(x" + r.x.toFixed(1) + " z" + r.z.toFixed(1) + " " + r.mode
    + " 平均" + r.v.toFixed(1) + "m/s 最寄り" + r.near.toFixed(2) + "m"
    + (r.sameTeam ? "味方" : "相手") + ")").join(" / "));
  const nears = inPlace.map((r) => r.near).sort((a, b) => a - b);
  const touching = inPlace.filter((r) => r.near < 0.70).length;
  console.log("  最寄りの選手との距離: 中央 " + nears[Math.floor(nears.length / 2)].toFixed(2)
    + "m / 0.70m 未満（＝押し合っている） " + touching + "/" + inPlace.length + "回");
  const fl = inPlace.map((r) => r.flip).sort((a, b) => a - b);
  console.log("  進行方向が前フレームと逆を向いた割合: 中央 "
    + (fl[Math.floor(fl.length / 2)] * 100).toFixed(0) + "% / 最大 "
    + (fl[fl.length - 1] * 100).toFixed(0) + "%（40%超＝毎フレーム行ったり来たり: "
    + inPlace.filter((r) => r.flip > 0.4).length + "/" + inPlace.length + "回）");
  const def = inPlace.filter((r) => r.def);
  console.log("  守備側の選手 " + def.length + "/" + inPlace.length + "回"
    + " / そのうち 戻り判定の境目(守備から見て z*s=0.5)の ±1.5m 以内 "
    + def.filter((r) => Math.abs(r.zd - 0.5) < 1.5).length + "回"
    + "（ビッグ " + def.filter((r) => Math.abs(r.zd - 0.5) < 1.5 && r.big).length + "回）");
  console.log("  守備側の z*s 分布: " + def.map((r) => r.zd.toFixed(1)).sort().join(" "));
  const mans = def.map((r) => r.man).filter((v) => v >= 0).sort((a, b) => a - b);
  console.log("  担当との距離: " + mans.map((v) => v.toFixed(1)).join(" "));
  console.log("  うち 5.0m の ±0.6m 以内: " + mans.filter((v) => Math.abs(v - 5) < 0.6).length
    + "/" + mans.length + "件");
  console.log("  相手と押し合い " + inPlace.filter((r) => r.near < 0.70 && !r.sameTeam).length
    + "回 / 味方と押し合い " + inPlace.filter((r) => r.near < 0.70 && r.sameTeam).length + "回");
}
