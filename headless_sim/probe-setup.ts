// 攻撃が型に入るまでの速さと、守備がマークに付いているかを測る。
//   ・ポゼッション開始から、攻撃5人が持ち場（フォーメーションのスポット）へ着くまでの時間
//   ・攻撃がリムから何mに居るか（3Pライン 6.75m / ペイント 2.5m の内外）
//   ・守備が担当マンから何m離れているか（マンの位置別）
//   ・ポゼッションの長さと、シュートが上がった時点で何人が型に入っていたか
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);

const d2 = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

let frames = 0;
// 攻撃の立ち位置（リムからの距離）の分布
const offBand = { paint: 0, mid: 0, arc: 0, out: 0, back: 0 };
// 守備と担当マンの距離（マンのリムからの距離で分ける）
const markBy: Record<string, number[]> = {};
// ポゼッション: 開始から「5人がスポット 2m 以内」までの時間と、シュートまでの時間
const setupT: number[] = [], shotT: number[] = [], atShot: number[] = [];
let poss = 0, noSetup = 0;
const byAge: Record<string, { d: number[]; v: number[]; n: number[]; r: number[] }> = {
  "1": { d: [], v: [], n: [], r: [] }, "2": { d: [], v: [], n: [], r: [] },
  "3": { d: [], v: [], n: [], r: [] }, "5": { d: [], v: [], n: [], r: [] },
  "8": { d: [], v: [], n: [], r: [] },
};
const possLen: number[] = [];
const farTail: { r: number; sr: number; off: number; v: number; back: boolean }[] = [];

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let curPoss = -1, t0 = 0, setAt = -1;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    frames++;
    const t = frames * DT;
    if (game.possession !== curPoss) {
      if (poss > 0) possLen.push(t - t0);
      curPoss = game.possession; t0 = t; setAt = -1; poss++;
    }
    const off = game.teamPlayers(game.possession);
    const def = game.teamPlayers(1 - game.possession);
    const rim = game.attackFloor(game.possession);
    const spots = game.formationSpots(game.possession);
    // 型に入ったか（ハンドラーを除く4人がスポット 2m 以内）
    if (setAt < 0 && game.ballMode === "held") {
      let ok = 0;
      for (const p of off) {
        if (p === game.handler) continue;
        const s = spots[p.spotIdx];
        if (s && d2(p.pos, s) < 2.0) ok++;
      }
      if (ok >= 4) { setAt = t - t0; setupT.push(setAt); }
    }
    // 経過時間の刻みでサンプル
    {
      const age = t - t0;
      for (const k of ["1", "2", "3", "5", "8"]) {
        const kk = Number(k);
        if (age < kk || age >= kk + DT * 1.5) continue;
        for (const p of off) {
          if (p === game.handler) continue;
          const sp = spots[p.spotIdx];
          if (sp) byAge[k].d.push(d2(p.pos, sp));
          byAge[k].v.push(Math.hypot(p.velX, p.velZ));
          // ⚠️ 「自分のスポット」から遠くても、別のスポットに立っているだけかもしれない。
          //    一番近いスポットまでの距離と、リムからの距離も見る。
          let near = Infinity;
          for (const q of spots) near = Math.min(near, d2(p.pos, q));
          byAge[k].n.push(near);
          byAge[k].r.push(d2(p.pos, rim));
        }
      }
    }
    if (game.ballMode !== "held") continue;
    // 遠くで止まっている選手の内訳: 自分のスポットからどれだけ外れているか
    if (game.frontT) {
      for (const p of off) {
        if (p === game.handler) continue;
        const r = d2(p.pos, rim);
        const sp = spots[p.spotIdx];
        const sr = sp ? d2(sp, rim) : -1;
        const sgn = game.attackSign(p.team);
        farTail.push({ r, sr, off: sp ? d2(p.pos, sp) : -1, v: Math.hypot(p.velX, p.velZ),
          back: p.pos.z * sgn < 0 });
      }
    }
    for (const p of off) {
      const r = d2(p.pos, rim);
      const s = game.attackSign(p.team);
      if (p.pos.z * s < 0) offBand.back++;
      else if (r < 2.5) offBand.paint++;
      else if (r < 4.8) offBand.mid++;
      else if (r < THREE_DIST + 0.6) offBand.arc++;
      else offBand.out++;
    }
    for (const d of def) {
      const man = off[d.slot];
      if (!man) continue;
      const r = d2(man.pos, rim);
      const gap = d2(d.pos, man.pos);
      // ⚠️ 帯を細かく。攻撃のスポット(リムから6.95〜7.0m)と、守備を詰めるクランプの
      //    境目(THREE_DIST+0.2=6.95m)がぶつかっていないかを見る。
      const key = r < 2.5 ? "〜2.5" : r < 4.8 ? "2.5〜4.8" : r < 6.4 ? "4.8〜6.4"
        : r < 6.95 ? "6.4〜6.95" : r < 7.5 ? "6.95〜7.5" : "7.5〜";
      (markBy[key] ??= []).push(gap);
    }
  }
  void noSetup;
}
// シュートが上がった時点の型
console.log(NG + "試合 / ポゼッション " + poss + " 回");
const med = (a: number[]): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(2) : "-";
const pct = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * f)].toFixed(2) : "-";
console.log("型に入るまで（ハンドラー以外の4人がスポット2m以内）: "
  + setupT.length + "回 / 中央 " + med(setupT) + "秒 / 75% " + pct(setupT, 0.75)
  + "秒 / 90% " + pct(setupT, 0.9) + "秒");
const tot = Object.values(offBand).reduce((a, b) => a + b, 0);
console.log("攻撃の立ち位置（ボール保持中・のべ）: "
  + Object.entries(offBand).map(([k, v]) => k + " " + (v / tot * 100).toFixed(1) + "%").join(" / ")
  + "  ※paint<2.5m / mid<4.8m / arc<7.35m / out=それより外 / back=自陣側");
console.log("守備と担当マンの距離（マンの位置別・中央値と75%）:");
for (const k of ["〜2.5", "2.5〜4.8", "4.8〜6.4", "6.4〜6.95", "6.95〜7.5", "7.5〜"]) {
  const a = markBy[k] ?? [];
  console.log("  " + k.padEnd(6) + " " + a.length + "件  中央 " + med(a) + "m / 75% " + pct(a, 0.75)
    + "m / 3m超が " + (a.filter((v) => v > 3).length / Math.max(1, a.length) * 100).toFixed(0) + "%");
}

// ポゼッション開始からの経過別に「スポットまでの距離」と「速さ」を見る
console.log("\n開始からの経過ごと（オフボール攻撃4人）");
for (const [lbl, a] of Object.entries(byAge)) {
  if (!a.d.length) continue;
  console.log("  " + lbl.padStart(4) + "秒  スポットまで 中央 " + med(a.d) + "m"
    + " / 速さ 中央 " + med(a.v) + "m/s"
    + " / 一番近いスポットまで " + med(a.n) + "m / リムまで " + med(a.r) + "m"
    + " / 自分のスポット2m以内 " + (a.d.filter((x) => x < 2).length / a.d.length * 100).toFixed(0) + "%");
}
{
  const n = farTail.length;
  const over = (m: number): string => (farTail.filter((f) => f.r > m).length / n * 100).toFixed(1) + "%";
  console.log("\nフロントコート確立後・オフボール攻撃4人のリムからの距離: "
    + "7.35m超 " + over(7.35) + " / 8.5m超 " + over(8.5) + " / 10m超 " + over(10));
  // ⚠️ 「遠い」の大半は走って戻っている最中。止まっている(<0.5m/s)ものだけを見る。
  const still = farTail.filter((f) => f.v < 0.5);
  const sOver = (m: number): string =>
    (still.filter((f) => f.r > m).length / Math.max(1, still.length) * 100).toFixed(1) + "%";
  console.log("  立ち止まっている選手だけ（" + (still.length / n * 100).toFixed(0) + "% がこれ）: "
    + "7.35m超 " + sOver(7.35) + " / 8.5m超 " + sOver(8.5) + " / 10m超 " + sOver(10)
    + " / 自陣側 " + (still.filter((f) => f.back).length / Math.max(1, still.length) * 100).toFixed(1) + "%");
  const far = farTail.filter((f) => f.r > 8.5);
  if (far.length) {
    console.log("  8.5m超のとき: 自分のスポットのリム距離 中央 " + med(far.map((f) => f.sr)) + "m"
      + " / スポットまで 中央 " + med(far.map((f) => f.off)) + "m"
      + " / 速さ 中央 " + med(far.map((f) => f.v)) + "m/s"
      + " / 止まっている(0.3m/s未満) " + (far.filter((f) => f.v < 0.3).length / far.length * 100).toFixed(0) + "%");
  }
}
console.log("ポゼッションの長さ: 中央 " + med(possLen) + "秒 / 75% " + pct(possLen, 0.75) + "秒");
void shotT; void atShot;
