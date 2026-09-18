// 「決定力はあるが攻撃性が低い選手」と「ドライブ&キック型」が活きているかを測る。
//   ①試投数 ②アシスト ③カットの頻度 を、その傾向値の帯ごとに出す。
import "./stubs";
let _s = 0;
const setSeed = (v: number): void => { _s = v >>> 0; };
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { offBallScorer, driveKicker } from "../src/eval";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b").split(",").map((v) => Number(v) >>> 0);

type Row = { obs: number; dk: number; fga: number; ast: number; pts: number; cut: number; on: number };
const rows: Row[] = [];
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    const all = [...game.roster[0], ...game.roster[1]];
    const base = new Map(all.map((p) => [p, { f: p.stats.fga, a: p.stats.ast, s: p.stats.pts }]));
    const cut = new Map<Player, number>(all.map((p) => [p, 0]));
    const on = new Map<Player, number>(all.map((p) => [p, 0]));
    for (let i = 0; i < 60 * 60 * 8; i++) {
      game.update(DT);
      if (i % 6) continue;
      for (const p of game.teamPlayers(game.possession)) {
        on.set(p, (on.get(p) ?? 0) + 1);
        if (p.cutting) cut.set(p, (cut.get(p) ?? 0) + 1);
      }
    }
    for (const p of all) {
      const b = base.get(p)!;
      const o = on.get(p) ?? 0;
      if (o < 200) continue;                       // ほぼ出ていない選手は除く
      rows.push({ obs: offBallScorer(p), dk: driveKicker(p),
        fga: p.stats.fga - b.f, ast: p.stats.ast - b.a, pts: p.stats.pts - b.s,
        cut: cut.get(p) ?? 0, on: o });
    }
  }
}
const av = (a: number[]) => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-";
const band = (name: string, f: (r: Row) => number) => {
  console.log(`\n■ ${name}`);
  console.log(`  帯          人数   試投   アシスト  得点   カット中の割合`);
  for (const [lo, hi] of [[0, 0.01], [0.01, 0.35], [0.35, 0.7], [0.7, 1.01]]) {
    const a = rows.filter((r) => f(r) >= lo && f(r) < hi);
    if (!a.length) continue;
    const lbl = lo === 0 && hi === 0.01 ? "0(該当なし)" : lo.toFixed(2) + "-" + hi.toFixed(2);
    console.log(`  ${lbl.padEnd(11)} ${String(a.length).padStart(4)}  ${av(a.map((r) => r.fga)).padStart(5)}`
      + `  ${av(a.map((r) => r.ast)).padStart(6)}  ${av(a.map((r) => r.pts)).padStart(5)}`
      + `   ${(a.reduce((s, r) => s + r.cut / Math.max(1, r.on), 0) / a.length * 100).toFixed(1)}%`);
  }
};
console.log(`${NG * SEEDS.length}試合  出場した延べ ${rows.length} 選手ぶん（1試合あたり）`);
band("offBallScorer（決定力はあるが自分から仕掛けない）", (r) => r.obs);
band("driveKicker（突いて配れる）", (r) => r.dk);
