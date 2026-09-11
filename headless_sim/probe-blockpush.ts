// 体当たり(clearOut)とシュートフェイクが効いているか。ダンク/レイアップのブロック率も。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D, rate } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);

let fakes = 0, offBal = 0, shots = 0, rimShots = 0, rimMade = 0, swats = 0, rimSwats = 0;
const balOfPusher: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const wasFake = new Map<Player, number>();
  const wasBal = new Map<Player, number>();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    const before = game.stats ? 0 : 0;
    game.update(DT);
    for (const p of game.players) {
      const f = p.fakeT, w = wasFake.get(p) ?? 0;
      if (f > 0 && w === 0) fakes++;
      wasFake.set(p, f);
      const b = p.offBalT, wb = wasBal.get(p) ?? 0;
      if (b > 0 && wb === 0) { offBal++; if (game.handler) balOfPusher.push(rate(game.handler.attr.balance)); }
      wasBal.set(p, b);
    }
    if (mode !== "shot" && game.ballMode === "shot" && game.shooter) {
      shots++;
      const dh = dist2D(game.shooter.pos, game.attackFloor(game.shooter.team));
      if (dh < 2.6) { rimShots++; if (game.shotMade) rimMade++; }
    }
    void before;
  }
}
console.log(`${NG} 試合（各4分）`);
console.log(`シュートフェイク ${fakes} 回 = 試合あたり ${(fakes / NG).toFixed(1)} 回`);
console.log(`体当たりで崩した回数 ${offBal} 回 = 試合あたり ${(offBal / NG).toFixed(1)} 回`);
const avg = balOfPusher.length ? balOfPusher.reduce((a, b) => a + b, 0) / balOfPusher.length : 0;
console.log(`  押した側のボディバランス 平均 ${(avg * 100).toFixed(0)}/100（高いほど押し勝っている）`);
console.log(`リム至近(2.6m未満)のシュート ${rimShots} 本 / 成功 ${rimMade} 本（${(rimMade / Math.max(1, rimShots) * 100).toFixed(0)}%）`);
void swats; void rimSwats;
