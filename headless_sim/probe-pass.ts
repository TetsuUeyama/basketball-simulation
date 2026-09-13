// パサーの優位性の実測。パス開始フレームで
//  ・選んだ受け手のオープン度（最寄り守備との距離）と、その時点の最良候補との差
//  ・パスのズレ幅(game.passMiss)、カットされたか
//  ・アシスト/ターンオーバー
// をパサーの P精度(passAcc) 別に集計する。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { MAX_PASS } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 16);

type Row = { acc: number; pm: number; open: number; bestOpen: number; picked: boolean;
  miss: number; steal: boolean; d: number };
const rows: Row[] = [];
let astTot = 0, tovTot = 0;
const byP = new Map<Player, { ast: number; tov: number; acc: number; pm: number; n: number }>();

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const ast = new Map<Player, number>(), tov = new Map<Player, number>();
  for (const p of all) { ast.set(p, p.stats.ast); tov.set(p, p.stats.tov); }
  let seen: Player | null = null, seenTo: Player | null = null;
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    const ps = game.passer, to = game.passTo;
    if (game.ballMode === "pass" && ps && to && (ps !== seen || to !== seenTo)) {
      seen = ps; seenTo = to;
      // その瞬間に選べた味方のうち、最もオープンだった者
      let bestOpen = -1;
      for (const q of game.teamPlayers(ps.team)) {
        if (q === ps || dist2D(ps.pos, q.pos) > MAX_PASS) continue;
        bestOpen = Math.max(bestOpen, game.nearestDefenderDist(q));
      }
      const open = game.nearestDefenderDist(to);
      rows.push({
        acc: ps.attr.passAcc, pm: ps.playmaking, open, bestOpen,
        picked: bestOpen < 0 || open >= bestOpen - 0.05,
        miss: game.passMiss, steal: !!game.passSteal, d: dist2D(ps.pos, to.pos),
      });
      const e = byP.get(ps) ?? { ast: 0, tov: 0, acc: ps.attr.passAcc, pm: ps.playmaking, n: 0 };
      e.n++; byP.set(ps, e);
    }
    if (game.ballMode !== "pass") { seen = null; seenTo = null; }
  }
  for (const p of all) {
    const a = p.stats.ast - (ast.get(p) ?? 0), t = p.stats.tov - (tov.get(p) ?? 0);
    astTot += a; tovTot += t;
    const e = byP.get(p); if (e) { e.ast += a; e.tov += t; }
  }
}
const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
console.log(`${NG}試合  パス ${rows.length}本 / アシスト ${astTot} / ターンオーバー ${tovTot}`);
console.log("\nパサーの P精度(passAcc) 別:");
for (const [lo, hi] of [[0, 65], [65, 78], [78, 88], [88, 101]]) {
  const a = rows.filter((r) => r.acc >= lo && r.acc < hi);
  if (!a.length) { console.log(`  ${lo}〜${hi}: 標本なし`); continue; }
  console.log(`  ${lo}〜${hi}: ${a.length}本`
    + ` / 受け手のオープン度 ${avg(a.map((r) => r.open)).toFixed(2)}m`
    + ` (その時の最良 ${avg(a.map((r) => r.bestOpen)).toFixed(2)}m`
    + ` → 最良を選べた ${(a.filter((r) => r.picked).length / a.length * 100).toFixed(0)}%)`
    + ` / ズレ ${avg(a.map((r) => r.miss)).toFixed(2)}m`
    + ` / カット ${(a.filter((r) => r.steal).length / a.length * 100).toFixed(1)}%`);
}
console.log("\nロール(playmaking)別:");
for (const [lo, hi] of [[0, 0.4], [0.4, 0.7], [0.7, 1.01]]) {
  const a = rows.filter((r) => r.pm >= lo && r.pm < hi);
  if (!a.length) continue;
  console.log(`  pm ${lo}〜${hi}: ${a.length}本 / オープン度 ${avg(a.map((r) => r.open)).toFixed(2)}m / カット ${(a.filter((r) => r.steal).length / a.length * 100).toFixed(1)}%`);
}
const list = [...byP.entries()].filter(([, e]) => e.n >= 20)
  .sort((a, b) => b[1].acc - a[1].acc);
console.log("\nP精度の高い選手 / 低い選手（パス20本以上）:");
const show = (e: [Player, { ast: number; tov: number; acc: number; pm: number; n: number }]) =>
  console.log(`  ${e[0].name.padEnd(16)} P精度 ${String(e[1].acc).padStart(3)} pm ${e[1].pm.toFixed(2)} / パス ${e[1].n} AST ${e[1].ast} TOV ${e[1].tov} / AST per pass ${(e[1].ast / e[1].n * 100).toFixed(1)}%`);
for (const e of list.slice(0, 5)) show(e);
console.log("  ...");
for (const e of list.slice(-5)) show(e);
