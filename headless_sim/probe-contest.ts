// 3Pを打たれた瞬間の守備距離と、距離帯ごとの成功率。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 30);
const BANDS: [number, number][] = [[0, 1.2], [1.2, 1.8], [1.8, 2.5], [2.5, 3.5], [3.5, 99]];
const byGap = new Map<string, { a: number; m: number }>();
// 射手の能力帯 × 守備距離
const byAcc = new Map<string, { a: number; sumGap: number }>();
let lastShooter: Player | null = null;
let tot = 0, made = 0, sumGap = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== lastShooter) {
      lastShooter = sh;
      const d = dist2D(sh.pos, game.attackFloor(sh.team));
      // ⚠️ 距離で3Pを判定すると、リリース後に動いた分で2Pを拾ってしまう。
      //    エンジンが決めた shotPoints で数える。
      if (game.shotPoints === 3) {
        const nd = game.nearestDefender(sh);
        const gap = nd ? dist2D(sh.pos, nd.pos) : 9;
        tot++; sumGap += gap; if (game.shotMade) made++;
        const [x, y] = BANDS.find(([a, b]) => gap >= a && gap < b) ?? BANDS[0];
        const k = `${x}〜${y}`;
        if (!byGap.has(k)) byGap.set(k, { a: 0, m: 0 });
        const e = byGap.get(k)!; e.a++; if (game.shotMade) e.m++;
        const ab = sh.attr.threeAcc >= 85 ? "85以上" : sh.attr.threeAcc >= 78 ? "78〜85" : "78未満";
        if (!byAcc.has(ab)) byAcc.set(ab, { a: 0, sumGap: 0 });
        const f = byAcc.get(ab)!; f.a++; f.sumGap += gap;
      }
    }
    if (!sh) lastShooter = null;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  3P試投 ${tot} / 成功 ${made} (${pc(made, tot)}) / 平均の守備距離 ${(sumGap / Math.max(1, tot)).toFixed(2)}m`);
console.log("\n■ 打たれた時の守備距離 別");
for (const [x, y] of BANDS) {
  const e = byGap.get(`${x}〜${y}`); if (!e) continue;
  console.log(`  ${x}〜${y === 99 ? "" : y}m: ${e.m}/${e.a} = ${pc(e.m, e.a)}  （試投の ${pc(e.a, tot)}）`);
}
console.log("\n■ 射手のL精度別 平均の守備距離（＝どれだけフリーにしているか）");
for (const k of ["78未満", "78〜85", "85以上"]) {
  const f = byAcc.get(k); if (!f) continue;
  console.log(`  ${k}: ${(f.sumGap / f.a).toFixed(2)}m  (${f.a}本)`);
}
