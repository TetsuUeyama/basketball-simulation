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
console.log("\n■ 守備との距離 1.2m（試合中の中央値）");
console.log("  精度\距離   3m      4m      5m      6m");
for (const acc of [60, 65, 70, 75, 80, 85, 90]) {
  const row = [3, 4, 5, 6].map((d) => pc(calc(acc, d, 1.2)).padEnd(8)).join("");
  console.log(`  ${String(acc).padEnd(11)}${row}`);
}
console.log("\n■ 精度70の選手を、守備との距離別に（距離は試合中の中央値 4.94m）");
for (const dd of [0.5, 0.8, 1.2, 1.5, 1.8, 2.5, 4.0]) {
  console.log(`  守備 ${dd}m: ${pc(calc(70, 4.94, dd))}`);
}
console.log("\n■ 精度70以下を、試合中の中央値の条件（4.94m / 守備1.2m）で");
for (const acc of [50, 55, 60, 65, 70]) {
  console.log(`  精度 ${acc}: ${pc(calc(acc, 4.94, 1.2))}`);
}
