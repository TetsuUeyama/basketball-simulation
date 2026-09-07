// リバウンドのジャンプのタイミングと、落下点の取り合いを見る。
import "./stubs";
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

const jumpDelay: number[] = [];    // ルーズ開始から踏み切りまでの秒
const jumpBallY: number[] = [];    // 踏み切った瞬間のボールの高さ
const peakGap: number[] = [];      // 頂点のときのボールとの水平距離
const secured: number[] = [];
for (let gi = 0; gi < 4; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 4);
  g.applyRoster(); g.reset();
  let age = 0; let wasLoose = false;
  const jumped = new Set<Player>();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const reb = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    const before = new Map(game.players.map((p) => [p, p.airborne]));
    game.update(DT);
    if (reb) {
      age += DT;
      for (const p of game.players) {
        if (!before.get(p) && p.airborne && !jumped.has(p)) {
          jumped.add(p);
          jumpDelay.push(age);
          jumpBallY.push(game.ball.pos.y);
        }
        // 頂点付近でのボールとの距離
        if (p.airborne && Math.abs(p.jumpY() - 0.55) < 0.08) {
          peakGap.push(dist2DTo(game.ball.pos, p.pos.x, p.pos.z));
        }
      }
      wasLoose = true;
    } else if (wasLoose) { wasLoose = false; age = 0; jumped.clear(); }
  }
}
const med = (a: number[]): string => {
  if (!a.length) return "-";
  const c = [...a].sort((x, y) => x - y); return c[c.length >> 1].toFixed(2);
};
console.log(`4試合`);
console.log(`  踏み切り ${jumpDelay.length} 回`);
console.log(`  ルーズ開始から踏み切りまで  中央 ${med(jumpDelay)}秒`);
console.log(`  踏み切った瞬間のボールの高さ 中央 ${med(jumpBallY)}m`);
console.log(`  頂点でのボールとの水平距離   中央 ${med(peakGap)}m（${peakGap.length} 標本）`);
void secured;
