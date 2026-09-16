// ①ターンオーバーとドライブ挑戦を「ドリブル能力」別に
// ②シュート距離の分布（3Pラインの手前に山があるか）
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
const NG = Number(process.env.NG ?? 10);

const BANDS: [number, number][] = [[0, 60], [60, 70], [70, 80], [80, 101]];
const key = (v: number) => BANDS.find(([a, b]) => v >= a && v < b) ?? BANDS[0];
type A = { tov: number; drive: number; poss: number; spd: number; spdN: number };
const byHand = new Map<string, A>();
const at = (v: number): A => {
  const [a, b] = key(v); const k = `${a}〜${b}`;
  if (!byHand.has(k)) byHand.set(k, { tov: 0, drive: 0, poss: 0, spd: 0, spdN: 0 });
  return byHand.get(k)!;
};
// シュート距離のヒストグラム（0.5m刻み、アーク前後を細かく）
const hist = new Map<number, number>();
let shotN = 0, threeN = 0;
let lastShooter: Player | null = null;
const prevTov = new Map<Player, number>();
const driving = new Set<Player>();

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  for (const p of all) prevTov.set(p, p.stats.tov);
  driving.clear();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const h0 = game.handler;
    game.update(DT);
    // ドライブ挑戦の開始（beatenT/powerT が新たに立った瞬間）
    if (h0) {
      const on = h0.beatenT > 0 || h0.powerT > 0;
      if (on && !driving.has(h0)) { driving.add(h0); at(h0.attr.handling).drive++; }
      if (!on) driving.delete(h0);
      const a = at(h0.attr.handling);
      a.poss++; a.spd += h0.curSpd; a.spdN++;
    }
    for (const p of all) {
      const was = prevTov.get(p) ?? 0;
      if (p.stats.tov > was) { prevTov.set(p, p.stats.tov); at(p.attr.handling).tov++; }
    }
    const sh = game.shooter;
    if (sh && sh !== lastShooter) {
      lastShooter = sh;
      const d = dist2D(sh.pos, game.attackFloor(sh.team));
      shotN++; if (d > THREE_DIST) threeN++;
      const b = Math.floor(d * 2) / 2;
      hist.set(b, (hist.get(b) ?? 0) + 1);
    }
    if (!sh) lastShooter = null;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  総試投 ${shotN} / うち3P ${threeN} (${pc(threeN, shotN)})  3Pライン ${THREE_DIST}m`);
console.log("\n■ ドリブル能力(handling)別");
for (const [a, b] of BANDS) {
  const k = `${a}〜${b}`; const v = byHand.get(k); if (!v) continue;
  console.log(`  ${k}: 保持フレーム ${v.poss} / ドライブ挑戦 ${v.drive}`
    + ` (1000フレームあたり ${(v.drive / Math.max(1, v.poss) * 1000).toFixed(1)})`
    + ` / TOV ${v.tov}`
    + ` / 平均速度 ${(v.spd / Math.max(1, v.spdN)).toFixed(2)}m/s`);
}
console.log("\n■ シュート距離の分布（0.5m刻み / アーク周辺）");
for (let d = 4.0; d <= 8.5; d += 0.5) {
  const n = hist.get(d) ?? 0;
  const mark = d >= THREE_DIST ? " ←3P" : (d >= 6.0 ? " ←アーク手前" : "");
  console.log(`  ${d.toFixed(1)}〜${(d + 0.5).toFixed(1)}m: ${String(n).padStart(4)} ${"#".repeat(Math.round(n / 2))}${mark}`);
}
