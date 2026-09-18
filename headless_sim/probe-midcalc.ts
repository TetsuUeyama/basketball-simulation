// ミドルの成功率を、実際の関数(jumpShotMakeProbability)を直接叩いて出す。
// ⚠️ 試合を回さないので本数のブレが無い。ただし「試合中に実際どんな距離/間合いで
//    打っているか」は別問題なので、実測（probe-mid）と併せて見ること。
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { PALM_HITBOX } from "../src/config";
import { jumpShotMakeProbability } from "../src/move/reaction/shot-outcome";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
(game as unknown as { applyRoster(): void; reset(): void }).applyRoster();
const sh = game.teamPlayers(0)[0];
const df = game.teamPlayers(1)[0];
// 中庸の守備者にする（コンテストの質を代表値に固定）
df.attr.defense = 75; df.attr.agility = 75; df.attr.jump = 75;
sh.attr.shotStrength = 75; sh.attr.shotTech = 75;

const calc = (acc: number, dHoop: number, dDef: number): number => {
  sh.attr.midAcc = acc;
  sh.quickT = 0; sh.setupT = 0; sh.beatenT = 0; sh.curSpd = 0;
  // airborne は getter（ジャンプ状態から算出）なので触らない。地上のままで良い。
  return jumpShotMakeProbability(sh, dHoop, dDef, {
    isThree: false, nearestDef: df, helpCount: 1, clutch: 0,
    prepShort: 0, prepExtra: 0, palmHitbox: PALM_HITBOX,
  });
};
const pc = (v: number) => (v * 100).toFixed(1) + "%";
console.log("守備者は能力75の中庸。S威力75 / S技術75。クラッチ・溜め不足なしの条件。");
for (const acc of [65, 80]) {
  console.log("");
  console.log("=== S精度 " + acc + " ===");
  console.log("  距離      フリー   守備2.0m 守備1.5m 守備1.2m 守備1.0m 守備0.8m 守備0.5m");
  for (const d of [2, 3, 4, 5, 6, 7]) {
    const row = [9, 2.0, 1.5, 1.2, 1.0, 0.8, 0.5]
      .map((dd) => pc(calc(acc, d, dd)).padEnd(9)).join("");
    console.log("  " + (d + "m").padEnd(10) + row);
  }
}
console.log("");
console.log("=== コンテストの減点だけを取り出す（S精度80・5m を基準に） ===");
const base80 = calc(80, 5, 9);
for (const dd of [2.0, 1.5, 1.2, 1.0, 0.8, 0.5]) {
  const v = calc(80, 5, dd);
  console.log("  守備 " + dd + "m: " + pc(v) + "  （フリー " + pc(base80) + " から "
    + ((v - base80) * 100).toFixed(1) + "pt）");
}
