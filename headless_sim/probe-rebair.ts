// リバウンドを「空中で確保したか、床に降りてから確保したか」だけを見る。
// REB_DEBUG に依存しないので、修正前のコミットでもそのまま動く。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60;
const g = game as unknown as { applyRoster(): void; reset(): void };
const NG = Number(process.env.NG ?? 4);
let air = 0, ground = 0, floor = 0, n = 0;
const tips: number[] = [];
let nearMiss = 0;   // ボールに 0.6m 以内には入ったが確保できなかった場面
let reached = 0;
const grabY: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasReb = false, sawFloor = false, sawReach = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (reb && game.ball.pos.y < 0.35) sawFloor = true;
    if (reb) {
      for (const q of game.players) {
        const dx = q.pos.x - game.ball.pos.x, dz = q.pos.z - game.ball.pos.z;
        if (dx * dx + dz * dz < 0.36 && game.ball.pos.y <= q.reachTopY() && game.ball.pos.y > 0.3) { sawReach = true; break; }
      }
    }
    game.update(DT);
    if (wasReb && game.ballMode !== "loose") {
      n++;
      if (sawFloor) floor++;
      const h = game.handler;
      if (h && h.airborne) air++; else if (h) ground++;
      if (h) grabY.push(game.ball.pos.y);
      tips.push((game as unknown as { looseTips: number }).looseTips);
      if (sawReach) reached++; else nearMiss++;
      sawFloor = false; sawReach = false;
    }
    if (!reb) { sawFloor = false; sawReach = false; }
    wasReb = reb;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`リバウンド ${n} 回（${NG} 試合）`);
console.log(`  空中で確保        ${air} 回  ${(air / Math.max(1, n) * 100).toFixed(0)}%`);
console.log(`  床に降りてから確保 ${ground} 回  ${(ground / Math.max(1, n) * 100).toFixed(0)}%`);
console.log(`  ボールが床まで落ちた ${floor} 回  ${(floor / Math.max(1, n) * 100).toFixed(0)}%`);
console.log(`確保した時のボールの高さ 中央 ${q(grabY, .5)}m  上位25% ${q(grabY, .75)}m`);
console.log(`手が届く位置に入れた場面 ${reached} / 入れなかった ${nearMiss}`);
console.log(`1場面あたりの弾いた回数 中央 ${q(tips, .5)}  平均 ${(tips.reduce((a, b) => a + b, 0) / Math.max(1, tips.length)).toFixed(2)}`);
