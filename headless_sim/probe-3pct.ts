// 試合で実際に決まっている3Pを、L精度(threeAcc)の帯別に出す。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
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
const NG = Number(process.env.NG ?? 30);
const BANDS: [number, number][] = [[0, 70], [70, 75], [75, 80], [80, 85], [85, 90], [90, 95], [95, 101]];
const acc = new Map<string, { a: number; m: number }>();
const key = (v: number) => { const [x, y] = BANDS.find(([a, b]) => v >= a && v < b) ?? BANDS[0]; return `${x}〜${y}`; };
let tA = 0, tM = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const b0 = new Map(all.map((p) => [p, { a: p.stats.tpa, m: p.stats.tpm }]));
  for (let i = 0; i < 60 * 60 * 8; i++) game.update(DT);
  for (const p of all) {
    const b = b0.get(p)!;
    const da = p.stats.tpa - b.a, dm = p.stats.tpm - b.m;
    if (da === 0) continue;
    const k = key(p.attr.threeAcc);
    if (!acc.has(k)) acc.set(k, { a: 0, m: 0 });
    const e = acc.get(k)!; e.a += da; e.m += dm;
    tA += da; tM += dm;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  3PA ${tA} / 3PM ${tM} → 全体 ${pc(tM, tA)}`);
console.log(`  1チーム1試合あたり 3PA ${(tA / NG / 2).toFixed(1)}本\n`);
console.log("■ L精度(threeAcc)の帯別");
for (const [x, y] of BANDS) {
  const e = acc.get(`${x}〜${y}`); if (!e) continue;
  console.log(`  ${x}〜${y}: ${e.m}/${e.a} = ${pc(e.m, e.a)}`);
}
