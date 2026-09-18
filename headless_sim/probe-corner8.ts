// コーナーとウイングに実際に立っているのは誰か（役割・L精度）。
// ⚠️ コーナーは3Pの持ち場なので、上手い選手が立っているべき。
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
const NG = Number(process.env.NG ?? 6);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b,0xc2b2ae35").split(",").map((v) => Number(v) >>> 0);

// 持ち場(spotIdx)ごとに、就いている選手の L精度 と 役割
const bySpot = new Map<number, { acc: number[]; role: Record<string, number> }>();
// 役割ごとの「リムからの距離」
const roleRim: Record<string, number[]> = {};
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    for (let i = 0; i < 60 * 60 * 8; i++) {
      game.update(DT);
      if (!game.frontT || i % 10) continue;
      for (const p of game.teamPlayers(game.possession)) {
        if (p === game.handler) continue;
        let e = bySpot.get(p.spotIdx);
        if (!e) { e = { acc: [], role: {} }; bySpot.set(p.spotIdx, e); }
        e.acc.push(p.attr.threeAcc);
        e.role[p.role] = (e.role[p.role] ?? 0) + 1;
        (roleRim[p.role] ||= []).push(dist2D(p.pos, game.attackFloor(p.team)));
      }
    }
  }
}
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(1) : "-";
const NAMES = ["0 トップ", "1 左ウイング", "2 右ウイング", "3 左コーナー", "4 右コーナー", "5 ローブロック", "6 ショートコーナー"];
console.log(`${NG * SEEDS.length}試合  持ち場ごとに「就いている選手」を見る`);
for (let i = 0; i < 7; i++) {
  const e = bySpot.get(i);
  if (!e) { console.log(`  ${NAMES[i]}: -`); continue; }
  const tot = Object.values(e.role).reduce((s, v) => s + v, 0);
  const roles = Object.entries(e.role).sort((a, b) => b[1] - a[1])
    .map(([r, n]) => r + " " + (n / tot * 100).toFixed(0) + "%").join(" / ");
  console.log(`  ${NAMES[i].padEnd(14)} L精度 中央 ${med(e.acc).padStart(5)}  (${e.acc.length}件)  ${roles}`);
}
console.log(`\n■ 役割ごとの「リムからの距離」中央値`);
for (const r of ["PG", "SG", "SF", "PF", "C"]) {
  const a = roleRim[r];
  if (!a) continue;
  const inPaint = a.filter((v) => v < 3.5).length / a.length * 100;
  console.log(`  ${r}: ${med(a)}m  / ゴール下(3.5m内)に居る割合 ${inPaint.toFixed(1)}%`);
}
