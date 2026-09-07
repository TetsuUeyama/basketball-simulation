// リバウンドの間、跳ぼうとした選手がなぜ跳べないのか。landT（着地硬直）の残りと、
// その硬直がどのジャンプから来ているのかを見る。
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
const DT = 1 / 60;
const g = game as unknown as { applyRoster(): void; reset(): void };
const landAtStart: number[] = [];
const landDurAll: number[] = [];
let n = 0, froze = 0;
// 直近のジャンプの高さ（どのジャンプが硬直を生んだか）
const lastJumpH = new Map<Player, number>();
for (let gi = 0; gi < 4; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 4);
  g.applyRoster(); g.reset();
  let wasReb = false;
  const wasAir = new Map<Player, boolean>();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    for (const p of game.players) {
      const was = wasAir.get(p) ?? false;
      if (p.airborne && !was) lastJumpH.set(p, p.jumpHeight);
      wasAir.set(p, p.airborne);
    }
    game.update(DT);
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (reb && !wasReb) {
      n++;
      // ルーズ開始時、ボールに近い3人の硬直
      const near = [...game.players].sort((a, b) =>
        dist2DTo(game.ball.pos, a.pos.x, a.pos.z) - dist2DTo(game.ball.pos, b.pos.x, b.pos.z)).slice(0, 3);
      for (const p of near) {
        landAtStart.push(p.landT);
        if (p.landT > 0) { froze++; landDurAll.push(lastJumpH.get(p) ?? -1); }
      }
    }
    wasReb = reb;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`リバウンド ${n} 回、近い3人 ${landAtStart.length} 人ぶん`);
console.log(`ルーズ開始時に着地硬直中だった人 ${froze} / ${landAtStart.length}`);
console.log(`その硬直の残り時間 中央 ${q(landAtStart.filter((x) => x > 0), .5)}秒  最大 ${q(landAtStart, .99)}秒`);
console.log(`硬直を生んだジャンプの高さ 中央 ${q(landDurAll.filter((x) => x >= 0), .5)}m`);
