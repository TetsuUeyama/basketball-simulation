// ボックスアウトの不利を能力で覆せるか。
// チーム0 の身長とボディバランスだけを底上げして実試合を回し、
// 「チーム0 が攻めているときのオフェンスリバウンド率」を、素の状態と比べる。
import "./stubs";
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
const NG = Number(process.env.NG ?? 16);
type G2 = Game & { looseIsRebound: boolean; looseOff: number };

/** チーム0 を底上げして、そのチームが攻めているときのオフェンスリバウンド率を測る。 */
function run(dH: number, dB: number, label: string): void {
  let _s = 0x9e3779b9;
  Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
  let offWin = 0, defWin = 0;        // チーム0 が攻めている場面
  let offWin2 = 0, defWin2 = 0;      // チーム1 が攻めている場面（対照）
  const hs: number[] = [], bs: number[] = [];
  for (let gi = 0; gi < NG; gi++) {
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    for (const p of game.roster[0]) {
      p.height = Math.min(2.25, p.height + dH);
      p.attr.balance = Math.min(99, p.attr.balance + dB);
    }
    if (gi === 0) for (const p of game.roster[0]) { hs.push(p.height); bs.push(p.attr.balance); }
    let wasReb = false, side = 0;
    for (let i = 0; i < 60 * 60 * 4; i++) {
      const gg = game as G2;
      const reb = game.ballMode === "loose" && gg.looseIsRebound;
      if (reb && !wasReb) side = gg.looseOff;
      game.update(DT);
      if (wasReb && game.ballMode !== "loose") {
        const h = game.handler;
        if (h) {
          if (side === 0) { if (h.team === 0) offWin++; else defWin++; }
          else { if (h.team === 1) offWin2++; else defWin2++; }
        }
      }
      wasReb = reb;
    }
  }
  const t1 = offWin + defWin, t2 = offWin2 + defWin2;
  const avg = (a: number[]): string => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
  console.log(`${label}（チーム0 の平均 身長 ${avg(hs)}m / バランス ${avg(bs)}）`);
  console.log(`  チーム0 が攻めているとき オフェンスリバウンド ${(offWin / Math.max(1, t1) * 100).toFixed(0)}%（${offWin}/${t1}）`);
  console.log(`  チーム1 が攻めているとき オフェンスリバウンド ${(offWin2 / Math.max(1, t2) * 100).toFixed(0)}%（${offWin2}/${t2}）← 対照`);
}

run(0, 0, "① 底上げなし");
run(0.10, 12, "② 身長 +10cm・バランス +12");
run(0.18, 24, "③ 身長 +18cm・バランス +24（圧倒的）");
