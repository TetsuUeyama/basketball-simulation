// 指定した L速度/L精度 の選手が3Pを打つ時の「射程・溜め・成功率」を出す。
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { effShootRange, threePrepFor } from "../src/eval";
import { jumpShotMakeProbability } from "../src/move/reaction/shot-outcome";
import { THREE_DIST } from "../src/config";
// ⚠️ Player を直接 new すると描画系の初期化で落ちる。Game 経由で作った実体を借りる。
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 4);
(game as unknown as { applyRoster(): void }).applyRoster();
const p = game.roster[0][0];
const q = game.roster[1][0];   // 守備者役
const pct = (v: number) => (v * 100).toFixed(1) + "%";

function show(range: number, acc: number): void {
  p.attr.threeRange = range; p.attr.threeAcc = acc;
  p.attr.shotTech = 72; p.attr.shotStrength = 74; p.attr.bank = 72;
  const r = effShootRange(p);
  console.log(`\n■ L速度 ${range} / L精度 ${acc}`);
  console.log(`  射程 ${r.toFixed(2)}m （3Pライン ${THREE_DIST}m）→ ${r > THREE_DIST ? "3Pを打てる" : "3Pを打てない"}`);
  console.log(`  ライン際の溜め時間 ${threePrepFor(p, THREE_DIST).toFixed(2)}秒`);
  for (const d of [6.8, 7.0, 7.3]) {
    if (d > r + 0.3) { console.log(`  ${d.toFixed(1)}m: 射程外（打たない）`); continue; }
    const mk = (dDef: number) => jumpShotMakeProbability(p, d, dDef, {
      nearestDef: dDef < 3 ? q : null, helpCount: 0, clutch: 0,
      prepShort: 0, prepExtra: 0, palmHitbox: true,
    });
    console.log(`  ${d.toFixed(1)}m: フリー(守備3m) ${pct(mk(3))} / 普通(1.8m) ${pct(mk(1.8))} / 密着(0.9m) ${pct(mk(0.9))}`);
  }
}
show(65, 65);
show(75, 75);
show(85, 85);
show(95, 95);
