// オフボールが「そのまま3Pを打てる位置」に居るか。射程外まで下がっていないか。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { effShootRange } from "../src/eval";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);
let n = 0, beyond = 0, inArc = 0, sweet = 0, sumR = 0, sumRange = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 15 || !game.frontT) continue;
    const t = game.possession;
    const rim = game.attackFloor(t);
    for (const p of game.teamPlayers(t)) {
      if (p === game.handler || p.spotIdx >= 5) continue;
      const d = dist2D(p.pos, rim), r = effShootRange(p);
      n++; sumR += d; sumRange += r;
      if (d > r + 0.3) beyond++;
      else if (d < THREE_DIST) inArc++;
      else sweet++;
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  ペリメーターのオフボール ${n}件`);
console.log(`  平均: リムから ${(sumR / n).toFixed(2)}m / 射程 ${(sumRange / n).toFixed(2)}m`);
console.log(`  そのまま3Pを打てる位置（ライン外かつ射程内）: ${pc(sweet, n)}`);
console.log(`  射程外まで下がっている: ${pc(beyond, n)}  ← 受けても打てずドライブになる`);
console.log(`  ラインの内側: ${pc(inArc, n)}`);
