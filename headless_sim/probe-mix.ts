// 「打てない選手はゴール下を狙い、ジャンパーは仕方なく」が成立しているか。
// シュート精度帯ごとに、試投の内訳（リム下 / ミドル / 3P）と1試合あたりの本数を出す。
import "./stubs";
let _s = 0;
const setSeed = (v: number): void => { _s = v >>> 0; };
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b").split(",").map((v) => Number(v) >>> 0);

type Shot = { acc: number; kind: "rim" | "mid" | "three"; made: boolean; late: boolean };
const shots: Shot[] = [];
let tov = 0, poss = 0, clockOut = 0;
let lastShooter: Player | null = null;
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    const all = [...game.roster[0], ...game.roster[1]];
    const t0 = new Map(all.map((p) => [p, p.stats.tov]));
    let prevPoss = game.possession, prevClock = game.shotClock;
    for (let i = 0; i < 60 * 60 * 8; i++) {
      const before = game.shooter;
      game.update(DT);
      if (game.possession !== prevPoss) { poss++; prevPoss = game.possession; }
      if (prevClock > 0.5 && game.shotClock <= 0.05) clockOut++;
      prevClock = game.shotClock;
      const sh = game.shooter;
      if (sh && sh !== before && sh !== lastShooter) {
        lastShooter = sh;
        const d = dist2D(sh.pos, game.attackFloor(sh.team));
        const kind = game.shotPoints === 3 ? "three" : d < 2.5 ? "rim" : "mid";
        // ⚠️ 「仕方なく打った」= クロック残り 5秒未満。設計上ここは精度で削っていない。
        shots.push({ acc: Math.max(sh.attr.midAcc, sh.attr.threeAcc), kind,
          made: game.shotMade, late: game.shotClock < 5 });
      }
      if (!sh) lastShooter = null;
    }
    for (const p of all) tov += p.stats.tov - (t0.get(p) ?? 0);
  }
}
const G = NG * SEEDS.length;
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${G}試合  試投 ${shots.length}本 / ターンオーバー ${(tov / G / 2).toFixed(1)}本per チーム`);
console.log(`ポゼッション ${(poss / G).toFixed(0)}回/試合 / ショットクロック切れ ${(clockOut / G).toFixed(1)}回/試合`);
console.log(`\n■ シュート精度帯ごとの試投の内訳`);
console.log(`  精度帯      本数/試合  リム下     ミドル     3P        うち残5秒未満`);
for (const [lo, hi] of [[0, 70], [70, 75], [75, 80], [80, 85], [85, 101]]) {
  const a = shots.filter((s) => s.acc >= lo && s.acc < hi);
  if (!a.length) { console.log(`  ${(lo + "-" + hi).padEnd(11)} -`); continue; }
  const k = (t: string) => pc(a.filter((s) => s.kind === t).length, a.length).padEnd(10);
  console.log(`  ${(lo + "-" + hi).padEnd(11)}${(a.length / G / 2).toFixed(1).padEnd(10)} ${k("rim")}${k("mid")}${k("three")}${pc(a.filter((s) => s.late).length, a.length)}`);
}
console.log(`\n■ 成功率`);
for (const [lo, hi] of [[0, 70], [70, 75], [75, 80], [80, 85], [85, 101]]) {
  const a = shots.filter((s) => s.acc >= lo && s.acc < hi);
  if (!a.length) continue;
  const m = (t: string) => { const b = a.filter((s) => s.kind === t); return b.length ? pc(b.filter((s) => s.made).length, b.length) : "-"; };
  console.log(`  ${(lo + "-" + hi).padEnd(11)} リム下 ${m("rim").padEnd(8)} ミドル ${m("mid").padEnd(8)} 3P ${m("three")}`);
}
