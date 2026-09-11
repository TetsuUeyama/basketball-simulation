// シュートが「溜め(charge)」を通っているか。通っていない経路はどれか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);

let shots = 0, viaCharge = 0, ft = 0;
const dur: number[] = [];        // charge を通ったシュートの溜め秒数
const durRim: number[] = [], durJ: number[] = [], dur3: number[] = [];
let chgEnter = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let chg = 0, wasCharge = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    game.update(DT);
    const isChg = game.ballMode === "charge";
    if (isChg && !wasCharge) { chgEnter++; chg = 0; }
    if (isChg) chg += DT;
    if (mode !== "shot" && game.ballMode === "shot" && game.shooter) {
      shots++;
      if (wasCharge) {
        viaCharge++; dur.push(chg);
        const dh = dist2D(game.shooter.pos, game.attackFloor(game.shooter.team));
        if (game.shotPoints === 3) dur3.push(chg); else if (dh < 3) durRim.push(chg); else durJ.push(chg);
      }
    }
    if (mode === "freethrow" && game.ballMode !== "freethrow") ft++;
    wasCharge = isChg;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(3) : "-";
const line = (nm: string, a: number[]): void =>
  console.log(`  ${nm} ${a.length}本  中央 ${q(a, .5)}秒  25% ${q(a, .25)}秒  75% ${q(a, .75)}秒`);
console.log(`${NG} 試合  シュート ${shots} 本 / charge 突入 ${chgEnter} 回`);
console.log(`  charge を通ったシュート ${viaCharge} 本（${(viaCharge / Math.max(1, shots) * 100).toFixed(0)}%）`);
line("全体", dur); line("リム(3m未満)", durRim); line("ミドル", durJ); line("3P", dur3);
