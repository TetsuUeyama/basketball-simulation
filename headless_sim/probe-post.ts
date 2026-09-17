// ①得点のロール別内訳 ②攻撃のポストアンカーがどれだけフリーか
//   ③そのマーク役が誰か（守備のリムアンカーと噛み合っているか）
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
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
const NG = Number(process.env.NG ?? 16);
const pts: Record<string, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
let n = 0, sumGap = 0, free = 0, tight = 0;
let dropOnPost = 0, dropN = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const p0 = new Map(all.map((p) => [p, p.stats.pts]));
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 20 || !game.frontT) continue;
    const t = game.possession, d = 1 - t;
    const post = game.postAnchor(t);
    const rim = game.attackFloor(t);
    if (post && dist2D(post.pos, rim) < 5.0) {     // ゴール下に居る時だけ
      let nd = Infinity, who: Player | null = null;
      for (const q of game.teamPlayers(d)) {
        const gg = dist2D(q.pos, post.pos);
        if (gg < nd) { nd = gg; who = q; }
      }
      n++; sumGap += nd;
      if (nd > 2.0) free++; if (nd < 1.2) tight++;
      if (who) { dropN++; if (who.dropBig) dropOnPost++; }
    }
  }
  for (const p of all) pts[p.role] = (pts[p.role] ?? 0) + (p.stats.pts - (p0.get(p) ?? 0));
}
const tot = Object.values(pts).reduce((a, b) => a + b, 0);
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  総得点 ${tot}`);
console.log("\n■ 得点のロール別");
for (const r of ["PG", "SG", "SF", "PF", "C"]) console.log(`  ${r}: ${pts[r]} (${pc(pts[r], tot)})`);
console.log(`\n■ 攻撃のポストアンカーがゴール下(5m内)に居る時の最寄り守備 ${n}件`);
console.log(`  平均 ${(sumGap / Math.max(1, n)).toFixed(2)}m / 2m超フリー ${pc(free, n)} / 1.2m内で密着 ${pc(tight, n)}`);
console.log(`  最寄りが守備のドロップ役だった: ${pc(dropOnPost, dropN)}`);
