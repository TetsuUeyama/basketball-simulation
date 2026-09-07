// リバウンド中、選手が「手が届く時刻のボールの位置」に立てているか、
// ジャンプの頂点でボールに手が届いているか、着地直後に動けてしまっていないかを測る。
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2DTo, rate } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60, G = 9.0, FLOOR_Y = 0.32;
const g = game as unknown as { applyRoster(): void; reset(): void };
function planCatch(p: Player): { x: number; z: number; t: number; h: number } | null {
  const y0 = game.ball.pos.y, vy = game.ball.vel.y;
  const stand = p.height * 1.35, maxH = 0.55 + rate(p.attr.jump) * 0.45;
  const speed = p.runSpeed * 1.35, STEP = 1 / 30;
  for (let t = STEP; t <= 2.5; t += STEP) {
    const by = y0 + vy * t - G * t * t / 2;
    if (by < FLOOR_Y) break;
    if (by > stand + maxH) continue;
    const x = game.ball.pos.x + game.ball.vel.x * t, z = game.ball.pos.z + game.ball.vel.z * t;
    if (dist2DTo(p.pos, x, z) > speed * t + 0.35) continue;
    return { x, z, t, h: Math.max(0, by - stand) };
  }
  return null;
}
const toSpot: number[] = [], toBall: number[] = [];
const peakGap: number[] = [], peakDy: number[] = [];
const landMove: number[] = []; let landFroze = 0, landTotal = 0;
let airSecure = 0, groundSecure = 0;
for (let gi = 0; gi < 4; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 4);
  g.applyRoster(); g.reset();
  const wasAir = new Map<Player, boolean>();
  const land = new Map<Player, { x: number; z: number; t: number }>();
  let wasLoose = false, lastAir = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    const holderAir = game.ballHolder?.airborne ?? false;
    if (reb) lastAir = game.players.some((p) => p.airborne && dist2DTo(game.ball.pos, p.pos.x, p.pos.z) < 1.5);
    game.update(DT);
    if (wasLoose && game.ballMode === "held") { if (holderAir || lastAir) airSecure++; else groundSecure++; }
    wasLoose = reb;
    for (const p of game.players) {
      const air = p.airborne, was = wasAir.get(p) ?? false;
      if (was && !air && reb) { land.set(p, { x: p.pos.x, z: p.pos.z, t: 0 }); landTotal++; }
      const lp = land.get(p);
      if (lp) {
        if (lp.t < 0.1 && dist2DTo(p.pos, lp.x, lp.z) < 0.02) { /* 静止中 */ }
        lp.t += DT;
        if (lp.t >= 0.20) {
          const d = dist2DTo(p.pos, lp.x, lp.z);
          landMove.push(d); if (d < 0.05) landFroze++;
          land.delete(p);
        }
      }
      wasAir.set(p, air);
    }
    if (!reb) continue;
    for (const p of game.players) {
      if (dist2DTo(game.ball.pos, p.pos.x, p.pos.z) > 6) continue;
      const pc = planCatch(p);
      if (pc) { toSpot.push(dist2DTo(p.pos, pc.x, pc.z)); toBall.push(dist2DTo(game.ball.pos, p.pos.x, p.pos.z)); }
      if (p.airborne && p.jumpY() > p.jumpHeight * 0.85) {
        peakGap.push(dist2DTo(game.ball.pos, p.pos.x, p.pos.z));
        peakDy.push(game.ball.pos.y - p.reachTopY());
      }
    }
  }
}
const med = (a: number[]): string => a.length
  ? [...a].sort((x, y) => x - y)[a.length >> 1].toFixed(2) : "-";
console.log("リバウンド中の位置（中央値）");
console.log(`  手が届く時刻のボール位置まで ${med(toSpot)}m  （${toSpot.length} 標本）`);
console.log(`  ボールの今の位置まで         ${med(toBall)}m`);
console.log("\nジャンプの頂点で");
console.log(`  ボールとの水平距離 ${med(peakGap)}m（確保には 0.6m 以内が必要／${peakGap.length} 標本）`);
console.log(`  ボールの高さ − 手の届く高さ ${med(peakDy)}m（0 付近が理想、負は跳びすぎ）`);
console.log(`\n着地から 0.2 秒で動いた距離 ${med(landMove)}m（${landTotal} 回中 ${landFroze} 回はほぼ静止）`);
console.log(`確保: 空中 ${airSecure} 回 / 着地後 ${groundSecure} 回`);
