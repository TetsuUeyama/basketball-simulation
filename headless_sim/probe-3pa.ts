// stats の tpa/fga を直接数えて、距離から数えた3Pと一致するか確かめる。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST, RIM } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 10);
let tpa = 0, fga = 0, tpm = 0;
let hOut = 0, hIn = 0, hN = 0;          // ハンドラーがアークの外/内に居るフレーム
const hHist = new Map<number, number>();
let byDist = 0, shots = 0;
let lastShooter: Player | null = null;
const mism: string[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const p0 = new Map(all.map((p) => [p, { f: p.stats.fga, t: p.stats.tpa, m: p.stats.tpm }]));
  for (let i = 0; i < 60 * 60 * 8; i++) {
    if (game.handler && game.frontT && game.ballMode === "held") {
      const dh = dist2D(game.handler.pos, game.attackFloor(game.handler.team));
      hN++; if (dh > THREE_DIST) hOut++; else hIn++;
      const b = Math.floor(dh);
      hHist.set(b, (hHist.get(b) ?? 0) + 1);
    }
    const sh0 = game.shooter;
    const d0 = sh0 ? dist2D(sh0.pos, game.attackFloor(sh0.team)) : -1;
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== lastShooter) {
      lastShooter = sh;
      const d = dist2D(sh.pos, game.attackFloor(sh.team));
      shots++; if (d > THREE_DIST) byDist++;
      // 距離では3Pなのに shotPoints が 2 のケースを拾う
      if (d > THREE_DIST + 0.1 && game.shotPoints !== 3) {
        if (mism.length < 5) mism.push(`距離 ${d.toFixed(2)}m なのに shotPoints=${game.shotPoints}`);
      }
      if (d < THREE_DIST - 0.1 && game.shotPoints === 3) {
        if (mism.length < 5) mism.push(`距離 ${d.toFixed(2)}m なのに shotPoints=3`);
      }
    }
    if (!sh) lastShooter = null;
    void d0;
  }
  for (const p of all) {
    const b = p0.get(p)!;
    fga += p.stats.fga - b.f; tpa += p.stats.tpa - b.t; tpm += p.stats.tpm - b.m;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  3Pライン ${THREE_DIST}m / リムの |z| ${RIM.z}m`);
console.log(`  stats: FGA ${fga} / 3PA ${tpa} (${pc(tpa, fga)}) / 3PM ${tpm}`);
console.log(`  1チーム1試合あたり 3PA ${(tpa / NG / 2).toFixed(1)} 本`);
console.log(`  距離から数えた3P: ${byDist}/${shots} (${pc(byDist, shots)})`);
console.log("");
console.log(`■ ハンドラーの立ち位置（フロントコート・保持中 ${hN}フレーム）`);
console.log(`  3Pラインより外: ${pc(hOut, hN)} / 内: ${pc(hIn, hN)}`);
for (let d = 2; d <= 11; d++) {
  const n = hHist.get(d) ?? 0;
  console.log(`  ${d}〜${d + 1}m: ${pc(n, hN).padStart(6)} ${"#".repeat(Math.round(n / hN * 60))}`);
}
console.log(mism.length ? "\n■ 距離と shotPoints の食い違い:" : "\n食い違いなし");
for (const m of mism) console.log("  " + m);
