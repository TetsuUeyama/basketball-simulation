// パス・シュートの予備動作。リリース前にどれだけ「溜め」があるか。
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
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);

const passWind: number[] = [];    // パス: 溜めの秒数（pendingPassT が立っていた時間）
const chargeDur: number[] = [];   // シュート: 溜め(charge)の秒数
let passes = 0, windPasses = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let pend = 0, chg = 0;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const gg = game as unknown as { pendingPassTo: Player | null };
    const hadPend = !!gg.pendingPassTo;
    const wasCharge = game.ballMode === "charge";
    const mode = game.ballMode;
    game.update(DT);
    // パスの溜め
    if (hadPend) pend += DT;
    if (mode !== "pass" && game.ballMode === "pass") {
      passes++;
      passWind.push(pend);
      if (pend > 0.01) windPasses++;
      pend = 0;
    }
    if (!gg.pendingPassTo && !hadPend) pend = 0;
    // シュートの溜め
    if (wasCharge) chg += DT;
    if (wasCharge && game.ballMode !== "charge") { chargeDur.push(chg); chg = 0; }
    if (!wasCharge && game.ballMode !== "charge") chg = 0;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(3) : "-";
console.log(`${NG} 試合`);
console.log(`\nパス ${passes} 本`);
console.log(`  溜めがあったパス ${windPasses} 本（${(windPasses / Math.max(1, passes) * 100).toFixed(0)}%）`);
console.log(`  溜めの秒数 中央 ${q(passWind, .5)}秒  75% ${q(passWind, .75)}秒  95% ${q(passWind, .95)}秒`);
console.log(`\nシュートの溜め ${chargeDur.length} 回`);
console.log(`  秒数 中央 ${q(chargeDur, .5)}秒  25% ${q(chargeDur, .25)}秒  95% ${q(chargeDur, .95)}秒`);
