// リバウンドが始まった瞬間、選手は落下点までどれだけ離れていて、何秒あるのか。
// 「間に合わない」なら踏み切りの問題ではなく、シュート中の位置取りの問題。
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
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60, G = 9.0, FLOOR_Y = 0.32;
const g = game as unknown as { applyRoster(): void; reset(): void };
const gapAtStart: number[] = [], airTime: number[] = [], needSpd: number[] = [];
const shotGap: number[] = [];
let n = 0;
for (let gi = 0; gi < 4; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 4);
  g.applyRoster(); g.reset();
  let wasReb = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (reb && !wasReb) {
      // 落下点（床に着く場所）と、そこまでの時間
      const y0 = game.ball.pos.y, vy = game.ball.vel.y;
      const disc = vy * vy + 2 * G * (y0 - FLOOR_Y);
      const t = disc >= 0 ? Math.max(0.01, (vy + Math.sqrt(disc)) / G) : 0.01;
      const sx = game.ball.pos.x + game.ball.vel.x * t, sz = game.ball.pos.z + game.ball.vel.z * t;
      let best = Infinity, bp: Player | null = null;
      for (const p of game.players) {
        const d = dist2DTo(p.pos, sx, sz);
        if (d < best) { best = d; bp = p; }
      }
      gapAtStart.push(best); airTime.push(t);
      if (bp) needSpd.push(best / t);
      n++;
    }
    wasReb = reb;
    // シュートが飛んでいる間、リムに最も近い選手のリムまでの距離
    if (game.ballMode === "shot") {
      const rz = game.ball.pos.z > 0 ? 1 : -1;
      let best = Infinity;
      for (const p of game.players) best = Math.min(best, dist2DTo(p.pos, 0, rz * 13.1));
      shotGap.push(best);
    }
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`リバウンド ${n} 回`);
console.log(`落下点までの距離（一番近い選手）  中央 ${q(gapAtStart, .5)}m  75% ${q(gapAtStart, .75)}m  最大 ${q(gapAtStart, .99)}m`);
console.log(`落下までの時間                    中央 ${q(airTime, .5)}秒  25% ${q(airTime, .25)}秒`);
console.log(`必要な速さ                        中央 ${q(needSpd, .5)}m/s  75% ${q(needSpd, .75)}m/s（走れるのは約7m/s）`);
console.log(`シュート飛翔中、リムに一番近い選手 中央 ${q(shotGap, .5)}m`);
