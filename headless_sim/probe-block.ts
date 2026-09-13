// 後方からのブロックの実測。シューターは **fga の増分** で同定する（game.shooter は
// フレーム境界でズレるため使わない）。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D, dist2DTo } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { evadeBlockProbability } from "../src/move/reaction/contest-block";
import { THREE_DIST } from "../src/config";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);

type Att = { cos: number; dd: number; blocked: boolean; rim: boolean; dunk: boolean; hDiff: number; tech: number; three: boolean; evadeP: number };
const atts: Att[] = [];
let nBlk = 0, nFta = 0, nPts = 0;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const fga = new Map<Player, number>(), blk = new Map<Player, number>();
  const all = [...game.roster[0], ...game.roster[1]];
  for (const p of all) { fga.set(p, p.stats.fga); blk.set(p, p.stats.blk); }
  const fta0 = all.reduce((s, p) => s + p.stats.fta, 0);
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const fin0 = game.shooterFinishing, dunk0 = game.shotWasDunk;
    game.update(DT);
    let shooter: Player | null = null, blocker: Player | null = null;
    for (const p of all) {
      const f = fga.get(p) ?? 0;
      if (p.stats.fga > f) { fga.set(p, p.stats.fga); if (!shooter) shooter = p; }
      const b = blk.get(p) ?? 0;
      if (p.stats.blk > b) { blk.set(p, p.stats.blk); if (!blocker) blocker = p; }
    }
    if (!shooter) continue;
    const sh: Player = shooter;
    const rim = game.attackFloor(sh.team);
    const rimShot = fin0 || dist2D(sh.pos, rim) < 2.3;
    // 最も近い相手（ブロックが無い試投でも「誰が守っていたか」を見るため）
    let near: Player | null = null, nd = Infinity;
    for (const d of game.teamPlayers(1 - sh.team)) {
      const dd = dist2D(d.pos, sh.pos);
      if (dd < nd) { nd = dd; near = d; }
    }
    const ref = blocker ?? near;
    if (!ref) continue;
    const rx = rim.x - sh.pos.x, rz = rim.z - sh.pos.z, rl = Math.hypot(rx, rz) || 1;
    const bx = ref.pos.x - sh.pos.x, bz = ref.pos.z - sh.pos.z, bl = Math.hypot(bx, bz) || 1;
    atts.push({
      cos: (rx / rl) * (bx / bl) + (rz / rl) * (bz / bl),
      dd: bl, blocked: !!blocker, rim: rimShot, dunk: dunk0,
      hDiff: ref.height - sh.height,
      tech: sh.attr.shotTech, three: dist2D(sh.pos, rim) > THREE_DIST,
      evadeP: evadeBlockProbability(sh, ref),
    });
    if (blocker) nBlk++;
  }
  nFta += all.reduce((s, p) => s + p.stats.fta, 0) - fta0;
  nPts += game.score[0] + game.score[1];
}
const pct = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const rimA = atts.filter((a) => a.rim);
const FT = () => console.log(`  フリースロー ${nFta}本（1チーム1試合 ${(nFta / NG / 2).toFixed(1)}本） / 得点 ${(nPts / NG / 2).toFixed(1)}`);
console.log(`${NG}試合  試投 ${atts.length} / ブロック ${nBlk}（1チーム1試合 ${(nBlk / NG / 2).toFixed(1)}本）`);
console.log(`  ゴール下 ${rimA.length}本 → ブロック ${pct(rimA.filter((a) => a.blocked).length, rimA.length)}`);
FT();
console.log(`  　うちダンク ${rimA.filter((a) => a.dunk).length}本 → ブロック ${pct(rimA.filter((a) => a.dunk && a.blocked).length, rimA.filter((a) => a.dunk).length)}`);

const band = (a: Att) => a.cos > 0.35 ? "前(ゴール側)" : a.cos < -0.35 ? "後ろ(背後)" : "横";
console.log("\nゴール下の試投を「守備者がどこにいたか」で分ける:");
for (const nm of ["前(ゴール側)", "横", "後ろ(背後)"]) {
  const a = rimA.filter((x) => band(x) === nm);
  const b = a.filter((x) => x.blocked);
  console.log(`  ${nm}: 試投 ${a.length} → ブロック ${b.length} (${pct(b.length, a.length)})  平均距離 ${(a.reduce((s, x) => s + x.dd, 0) / Math.max(1, a.length)).toFixed(2)}m`);
}
const blocked = atts.filter((a) => a.blocked);
console.log("\nブロック成立分の内訳:");
for (const nm of ["前(ゴール側)", "横", "後ろ(背後)"]) {
  const a = blocked.filter((x) => band(x) === nm);
  console.log(`  ${nm}: ${a.length} (${pct(a.length, blocked.length)})  平均距離 ${(a.reduce((s, x) => s + x.dd, 0) / Math.max(1, a.length)).toFixed(2)}m  平均身長差 ${(a.reduce((s, x) => s + x.hDiff, 0) / Math.max(1, a.length) * 100).toFixed(0)}cm`);
}

console.log("\nシュート技術(shotTech)別のブロックされ率:");
for (const [lo, hi] of [[0, 60], [60, 75], [75, 88], [88, 101]]) {
  const a = atts.filter((x) => x.tech >= lo && x.tech < hi);
  const rim2 = a.filter((x) => x.rim), pull = a.filter((x) => !x.rim && !x.three);
  console.log(`  技術 ${lo}〜${hi}: 全体 ${pct(a.filter((x) => x.blocked).length, a.length)} (${a.length}本)`
    + ` / ゴール下 ${pct(rim2.filter((x) => x.blocked).length, rim2.length)} (${rim2.length})`
    + ` / 2Pジャンパー ${pct(pull.filter((x) => x.blocked).length, pull.length)} (${pull.length})`);
}
console.log("\nかわせる確率(evadeBlockProbability)の実分布 — ブロックの手が伸びた時に逃げられる率:");
for (const [lo, hi] of [[0, 60], [60, 75], [75, 88], [88, 101]]) {
  const a = atts.filter((x) => x.tech >= lo && x.tech < hi && !x.three);
  const m = a.reduce((s, x) => s + x.evadeP, 0) / Math.max(1, a.length);
  console.log(`  技術 ${lo}〜${hi}: 平均 ${(m * 100).toFixed(1)}%  最大 ${((a.length ? Math.max(...a.map((x) => x.evadeP)) : 0) * 100).toFixed(1)}%  (${a.length}本)`);
}
