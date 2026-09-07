// リバウンドの踏み切り1回ごとに、踏み切り位置のズレと、飛行中にボールへどこまで
// 近づけたかを測る。「跳んだのに空振りして着地後に拾う」がどれだけ残っているか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2DTo } from "../src/util";
import { REB_DEBUG } from "../src/core/looseball";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60;
const g = game as unknown as { applyRoster(): void; reset(): void };

type Fly = { p: Player; gap0: number; t0: number; minGap: number; minDy: number; dyAtNear: number; touched: boolean;
  topY: number; peakDy: number; peakGap: number; rising: boolean;
  age: number; tPeak: number; tNear: number; ballY0: number; won: boolean; other: boolean };
const flying: Fly[] = [];
const done: Fly[] = [];
const landed: { f: Fly; t: number }[] = [];
let whiffGrab = 0;   // 空振り→着地してから拾った回数
REB_DEBUG.onJump = (p, gap, t) => {
  flying.push({ p, gap0: gap, t0: t, minGap: Infinity, minDy: Infinity, dyAtNear: 0, touched: false,
    topY: -1, peakDy: 0, peakGap: 0, rising: game.ball.vel.y > 0,
    age: 0, tPeak: 0, tNear: 0, ballY0: game.ball.pos.y, won: false, other: false });
};
let airSecure = 0, groundSecure = 0;
const NG = Number(process.env.NG ?? 4);
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasReb = false, anyAir = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (wasReb && game.ballMode === "held") { if (anyAir) airSecure++; else groundSecure++; }
    anyAir = reb && game.players.some((p) => p.airborne && dist2DTo(game.ball.pos, p.pos.x, p.pos.z) < 1.2);
    wasReb = reb;
    for (let k = landed.length - 1; k >= 0; k--) {
      const L = landed[k];
      L.t += DT;
      if (game.ballMode === "held" && game.ballHolder === L.f.p && !L.f.touched) { whiffGrab++; landed.splice(k, 1); continue; }
      if (L.t > 1.2) landed.splice(k, 1);
    }
    for (let k = flying.length - 1; k >= 0; k--) {
      const f = flying[k];
      const gap = dist2DTo(game.ball.pos, f.p.pos.x, f.p.pos.z);
      const dy = game.ball.pos.y - f.p.reachTopY();
      // 跳躍の頂点フレーム（jumpY が最大になった瞬間）を捕まえる
      f.age += DT;
      if (f.p.jumpY() > f.topY) { f.topY = f.p.jumpY(); f.peakDy = dy; f.peakGap = gap; f.tPeak = f.age; }
      if (gap < f.minGap) f.tNear = f.age;
      if (game.ballMode !== "loose" && game.handler) {
        if (game.handler === f.p) f.won = true; else f.other = true;
      }
      if (gap < f.minGap) f.dyAtNear = dy;
      f.minGap = Math.min(f.minGap, gap);
      f.minDy = Math.min(f.minDy, Math.abs(dy));
      if (gap < 0.6 && dy <= 0 && game.ball.pos.y > 0.3) f.touched = true;
      if (!f.p.airborne) { done.push(f); landed.push({ f, t: 0 }); flying.splice(k, 1); }
    }
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
const gap0 = done.map((f) => f.gap0), minGap = done.map((f) => f.minGap);
const minDy = done.map((f) => f.minDy);
console.log(`リバウンドの踏み切り ${done.length} 回`);
console.log(`踏み切り時の落下点までのズレ 中央 ${q(gap0, .5)}m  75% ${q(gap0, .75)}m`);
console.log(`飛行中の最短の水平距離       中央 ${q(minGap, .5)}m  75% ${q(minGap, .75)}m（0.6m 以内で届く）`);
console.log(`飛行中の高さのズレの最小      中央 ${q(minDy, .5)}m`);
const dyN = done.map((f) => f.dyAtNear);
console.log(`最接近時のボール高さ − 手の高さ 中央 ${q(dyN, .5)}m（正ならボールが手の上、負なら下）`);
console.log(`手が届く条件を満たした踏み切り ${done.filter((f) => f.touched).length} / ${done.length}`);
const pdy = done.map((f) => f.peakDy), pgap = done.map((f) => f.peakGap);
console.log(`
最高打点で: ボールの高さ − 手の高さ 中央 ${q(pdy, .5)}m  25% ${q(pdy, .25)}m  75% ${q(pdy, .75)}m`);
console.log(`           届いていた踏み切り ${done.filter((f) => f.peakDy <= 0).length} / ${done.length}`);
console.log(`           水平距離 中央 ${q(pgap, .5)}m`);
console.log(`踏み切った時ボールが上昇中だった ${done.filter((f) => f.rising).length} / ${done.length}`);
const lag = done.map((f) => f.tNear - f.tPeak);
console.log(`
頂点から最接近までの時間 中央 ${q(lag, .5)}秒（正なら跳ぶのが早い／${done.filter((x) => x.tNear > x.tPeak + 0.03).length} 回が早い）`);
console.log(`踏み切った選手が確保した ${done.filter((f) => f.won).length} 回 / 別の選手が確保した ${done.filter((f) => !f.won && f.other).length} 回`);
console.log(`踏み切った時のボールの高さ 中央 ${q(done.map((f) => f.ballY0), .5)}m`);
console.log(`確保: 空中 ${airSecure} 回 / 着地後 ${groundSecure} 回`);
console.log(`跳んだが空振りし、着地してから拾った ${whiffGrab} 回`);
