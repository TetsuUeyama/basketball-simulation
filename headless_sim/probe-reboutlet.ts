// ① リバウンドのボールが、競っている選手の頭上を通過していないか
// ② 確保してからパスを出すまでの時間・そのパスの距離と速さ
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D, dist2DTo } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);

const overBy: number[] = [];      // 最接近時 ボールの高さ − 手の届く高さ（正 = 頭上を通過）
let scenes = 0, passedOver = 0;
const secToPass: number[] = [];   // 確保からパスまでの秒
const passDist: number[] = [];    // そのパスの距離
const passSpd: number[] = [];     // そのパスの速さ
const airPass: number[] = [];     // 空中で出したパスの距離
const airSpd: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasReb = false;
  let best = new Map<Player, number>();   // 選手ごとの最接近時の (ball.y - reachTop)
  let bestGap = new Map<Player, number>();
  let secured: Player | null = null, secT = 0, secAir = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (reb) {
      for (const p of game.players) {
        const gap = dist2DTo(game.ball.pos, p.pos.x, p.pos.z);
        if (gap > 2) continue;
        const prev = bestGap.get(p);
        if (prev === undefined || gap < prev) {
          bestGap.set(p, gap);
          best.set(p, game.ball.pos.y - p.reachTopY());
        }
      }
    }
    const before = game.ballMode;
    game.update(DT);
    if (wasReb && game.ballMode !== "loose") {
      scenes++;
      // その場面で一番惜しかった選手（最接近が一番近い）
      let who: Player | null = null, wd = Infinity;
      for (const [p, d] of bestGap) if (d < wd) { wd = d; who = p; }
      if (who) {
        const dy = best.get(who)!;
        overBy.push(dy);
        if (dy > 0.05) passedOver++;
      }
      best = new Map(); bestGap = new Map();
      if (game.ballMode === "held" && game.handler) {
        secured = game.handler; secT = 0; secAir = game.handler.airborne;
      }
    }
    if (secured) {
      secT += DT;
      if (game.ballMode === "pass" && game.passer === secured) {
        const d = dist2D(game.passFrom, game.passCatch);
        secToPass.push(secT); passDist.push(d);
        passSpd.push(game.passDur > 0 ? d / game.passDur : 0);
        if (secAir) { airPass.push(d); airSpd.push(game.passDur > 0 ? d / game.passDur : 0); }
        secured = null;
      } else if (secT > 3 || game.ballMode === "loose") secured = null;
    }
    void before;
    wasReb = reb;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`リバウンド ${scenes} 場面（${NG} 試合）`);
console.log(`\n① 一番惜しかった選手の、最接近時「ボールの高さ − 手の届く高さ」`);
console.log(`  中央 ${q(overBy, .5)}m  75% ${q(overBy, .75)}m  95% ${q(overBy, .95)}m（正 = 頭上を通過）`);
console.log(`  頭上を通過した場面 ${passedOver} / ${overBy.length}（${(passedOver / Math.max(1, overBy.length) * 100).toFixed(0)}%）`);
console.log(`\n② 確保からパスまで`);
console.log(`  時間 中央 ${q(secToPass, .5)}秒  25% ${q(secToPass, .25)}秒（${secToPass.length} 本）`);
console.log(`  距離 中央 ${q(passDist, .5)}m  75% ${q(passDist, .75)}m  95% ${q(passDist, .95)}m`);
console.log(`  速さ 中央 ${q(passSpd, .5)}m/s  95% ${q(passSpd, .95)}m/s`);
console.log(`  うち空中で確保した分: ${airPass.length} 本 / 距離 中央 ${q(airPass, .5)}m 95% ${q(airPass, .95)}m / 速さ 中央 ${q(airSpd, .5)}m/s 95% ${q(airSpd, .95)}m/s`);
