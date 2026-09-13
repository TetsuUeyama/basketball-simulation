// ブロックの内訳（シュート種別・1人あたりの本数）と、かすり/リバウンドの量。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { reachOver } from "../src/move/reaction/contest-block";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 16);

type Kind = "3P" | "2Pジャンパー" | "ゴール下";
const att: Record<Kind, number> = { "3P": 0, "2Pジャンパー": 0, "ゴール下": 0 };
const blkBy: Record<Kind, number> = { "3P": 0, "2Pジャンパー": 0, "ゴール下": 0 };
const grzBy: Record<Kind, number> = { "3P": 0, "2Pジャンパー": 0, "ゴール下": 0 };
let nReb = 0, nBlkTot = 0, topBlk: number[] = [];
let nFgm = 0, nFga = 0, nPts = 0, nOr = 0, nDr = 0;
const overs: number[] = [];

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const fga = new Map<Player, number>(), blk = new Map<Player, number>();
  for (const p of all) { fga.set(p, p.stats.fga); blk.set(p, p.stats.blk); }
  const reb0 = all.reduce((s, p) => s + p.stats.reb, 0);
  const or0 = all.reduce((s, p) => s + p.stats.oreb, 0);
  const dr0 = all.reduce((s, p) => s + p.stats.dreb, 0);
  const blk0 = new Map(all.map((p) => [p, p.stats.blk]));
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const fin0 = game.shooterFinishing;
    const grz0 = game.shotGraze;
    game.update(DT);
    let sh: Player | null = null, bl: Player | null = null;
    for (const p of all) {
      const f = fga.get(p) ?? 0;
      if (p.stats.fga > f) { fga.set(p, p.stats.fga); if (!sh) sh = p; }
      const b = blk.get(p) ?? 0;
      if (p.stats.blk > b) { blk.set(p, p.stats.blk); if (!bl) bl = p; }
    }
    if (!sh) continue;
    const rim = game.attackFloor(sh.team);
    const dh = dist2D(sh.pos, rim);
    const kind: Kind = (fin0 || dh < 2.3) ? "ゴール下" : dh > THREE_DIST ? "3P" : "2Pジャンパー";
    att[kind]++;
    if (bl) { blkBy[kind]++; nBlkTot++; overs.push(reachOver(bl, sh)); }
    // かすり: releaseShot が game.shotGraze を立てる（0→正で検出）
    else if (grz0 === 0 && game.shotGraze > 0) grzBy[kind]++;
  }
  nReb += all.reduce((s, p) => s + p.stats.reb, 0) - reb0;
  nOr += all.reduce((s, p) => s + p.stats.oreb, 0) - or0;
  nDr += all.reduce((s, p) => s + p.stats.dreb, 0) - dr0;
  nFgm += all.reduce((s, p) => s + p.stats.fgm, 0);
  nFga += all.reduce((s, p) => s + p.stats.fga, 0);
  nPts += game.score[0] + game.score[1];
  for (const p of all) topBlk.push(p.stats.blk - (blk0.get(p) ?? 0));
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合（1試合=8分ぶんのシミュレーション）`);
console.log(`  リバウンド: 1チーム1試合 ${(nReb / NG / 2).toFixed(1)}本`);
console.log(`  内訳: OREB ${(nOr / NG / 2).toFixed(1)} + DREB ${(nDr / NG / 2).toFixed(1)} = ${((nOr + nDr) / NG / 2).toFixed(1)}（合計と一致するか: ${nOr + nDr === nReb ? "一致" : "不一致 " + (nOr + nDr) + " vs " + nReb}）`);
console.log(`  ブロック:   1チーム1試合 ${(nBlkTot / NG / 2).toFixed(1)}本`);
console.log(`  FG ${nFgm}/${nFga} = ${(nFgm / Math.max(1, nFga) * 100).toFixed(1)}%  ミス ${nFga - nFgm}本 → リバウンド率 ${(nReb / Math.max(1, nFga - nFgm) * 100).toFixed(1)}%`);
console.log(`  得点: 1チーム1試合 ${(nPts / NG / 2).toFixed(1)}`);
topBlk.sort((a, b) => b - a);
console.log(`  1選手1試合のブロック最多: ${topBlk[0]}本 / 上位10件 ${topBlk.slice(0, 10).join(",")}`);
console.log(`  5本以上ブロックした選手: ${topBlk.filter((n) => n >= 5).length}人 / 3本以上 ${topBlk.filter((n) => n >= 3).length}人（延べ ${NG * 26}人試合）`);
console.log("\nシュート種別:");
for (const k of ["3P", "2Pジャンパー", "ゴール下"] as Kind[]) {
  console.log(`  ${k}: 試投 ${att[k]} → ブロック ${blkBy[k]} (${pc(blkBy[k], att[k])}) / かすり ${grzBy[k]} (${pc(grzBy[k], att[k])})`);
}
console.log(`  合計: 試投 ${att["3P"] + att["2Pジャンパー"] + att["ゴール下"]} → ブロック ${pc(nBlkTot, att["3P"] + att["2Pジャンパー"] + att["ゴール下"])}`);
overs.sort((a, b) => a - b);
const q = (f: number) => overs.length ? overs[Math.floor((overs.length - 1) * f)].toFixed(2) : "-";
console.log(`\nブロック成立時の到達点差 over (m): 最小 ${q(0)} / 25% ${q(0.25)} / 中央 ${q(0.5)} / 75% ${q(0.75)} / 最大 ${q(1)}`);
