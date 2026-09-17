// ミドルレンジの**実測**成功率を、シュート精度帯・距離帯・守備の近さ別に出す。
// ⚠️ リムのフィニッシュ(レイアップ/ダンク)は別の式なので除く。ジャンプショット扱いの球だけ。
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

type Row = { acc: number; d: number; def: number; made: boolean };
const rows: Row[] = [];
let lastShooter: Player | null = null;
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    for (let i = 0; i < 60 * 60 * 8; i++) {
      const before = game.shooter;
      game.update(DT);
      const sh = game.shooter;
      if (sh && sh !== before && sh !== lastShooter) {
        lastShooter = sh;
        if (game.shotPoints === 3) continue;             // 3Pは別の式
        if (game.shooterFinishing || game.shotWasDunk) continue;  // リムのフィニッシュは別の式
        const dh = dist2D(sh.pos, game.attackFloor(sh.team));
        const nd = game.nearestDefender(sh);
        rows.push({ acc: sh.attr.midAcc, d: dh, def: nd ? dist2D(sh.pos, nd.pos) : 9,
          made: game.shotMade });
      }
      if (!sh) lastShooter = null;
    }
  }
}
const pc = (a: Row[]): string => a.length
  ? (a.filter((r) => r.made).length / a.length * 100).toFixed(1) + "%(" + a.length + ")" : "-";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
console.log(`${NG * SEEDS.length}試合  2Pジャンプショット ${rows.length}本（リムのフィニッシュは除く）`);
console.log(`  距離の中央値 ${med(rows.map((r) => r.d))}m / 守備との距離の中央値 ${med(rows.map((r) => r.def))}m`);
console.log(`\n■ シュート精度帯 × 距離帯`);
console.log(`  精度       0-2m      2-4m      4-6m      6m+       全体`);
for (const [lo, hi] of [[0, 65], [65, 70], [70, 75], [75, 80], [80, 85], [85, 101]]) {
  const a = rows.filter((r) => r.acc >= lo && r.acc < hi);
  const cell = (x: number, y: number) => pc(a.filter((r) => r.d >= x && r.d < y)).padEnd(10);
  console.log(`  ${(lo + "-" + hi).padEnd(9)} ${cell(0, 2)}${cell(2, 4)}${cell(4, 6)}${cell(6, 99)}${pc(a)}`);
}
console.log(`\n■ 精度70以下だけを、守備の近さ別に`);
const low = rows.filter((r) => r.acc <= 70);
for (const [lo, hi] of [[0, 0.8], [0.8, 1.2], [1.2, 1.8], [1.8, 99]]) {
  console.log(`  守備 ${lo}〜${hi}m: ${pc(low.filter((r) => r.def >= lo && r.def < hi))}`);
}
console.log(`\n■ 距離の分布（全2Pジャンプショット）`);
for (const [lo, hi] of [[0, 2], [2, 4], [4, 6], [6, 99]]) {
  const a = rows.filter((r) => r.d >= lo && r.d < hi);
  console.log(`  ${lo}〜${hi}m: ${(a.length / Math.max(1, rows.length) * 100).toFixed(1)}%  成功 ${pc(a)}`);
}
