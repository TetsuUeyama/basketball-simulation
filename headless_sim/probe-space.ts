// ①3Pを「角度」と「ラインからの距離」で分解する（正面の深い3Pとコーナーの3P）
// ②オフェンスのスペーシング（左右の偏り・団子になっていないか）
import "./stubs";
let _s = 0;
const setSeed = (v: number): void => { _s = v >>> 0; };
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST, THREE_CORNER_X, beyondArc, arcSlack } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b,0xc2b2ae35").split(",").map((v) => Number(v) >>> 0);

type Shot = { x: number; dz: number; r: number; slack: number; pts: number; made: boolean;
  arc: boolean; acc: number; def: number };
const shots: Shot[] = [];
// スペーシング
let frames = 0, oneSide = 0, bothSides = 0, clump = 0, driveClump = 0, driveFrames = 0;
const minGaps: number[] = [];
const nearBall: number[] = [];
const nearBallIn: number[] = [];
const widthL: number[] = [];
const widthR: number[] = [];
const spreads: number[] = [];
let lastShooter: Player | null = null;

for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    for (let i = 0; i < 60 * 60 * 8; i++) {
      // ⚠️ `game.shooter` が変わったフレームは**構え始め**であって、リリースではない。
      //    `shotPoints` / `shotMade` はリリース時（releaseShot）に設定されるので、
      //    構え始めで読むと**1本前の値**を拾う。実測で「線の外なのに2P」が 22.3% も
      //    出ていたのはこれが原因（大半の球が2Pなので、古い値を読むと2Pに偏る）。
      //    ballMode が "shot" に変わったフレーム＝リリース時に読むこと。
      const prevMode = game.ballMode;
      game.update(DT);
      const sh = game.shooter;
      if (sh && prevMode !== "shot" && game.ballMode === "shot") {
        lastShooter = sh;
        const rim = game.attackFloor(sh.team);
        const nd = game.nearestDefender(sh);
        shots.push({ x: Math.abs(sh.pos.x), dz: Math.abs(sh.pos.z - rim.z),
          r: dist2D(sh.pos, rim), slack: arcSlack(sh.pos.x, sh.pos.z, rim.z),
          pts: game.shotPoints, made: game.shotMade,
          arc: beyondArc(sh.pos.x, sh.pos.z, rim.z),
          acc: sh.attr.threeAcc, def: nd ? dist2D(sh.pos, nd.pos) : 9 });
      }
      if (!game.frontT || i % 6) continue;
      frames++;
      const off = game.teamPlayers(game.possession);
      const L = off.filter((p) => p.pos.x < -2).length;
      const R = off.filter((p) => p.pos.x > 2).length;
      if (L === 0 || R === 0) oneSide++;
      if (L >= 1 && R >= 1) bothSides++;
      // ⚠️ 「5人の最小間隔」はスクリーン中・カット中の選手も拾う。それらは
      //    **接近するのが正しい**動きなので、団子の指標からは外す。
      const still = off.filter((p) => p !== game.handler && !p.cutting && !p.screening);
      let mg = 99;
      for (let a = 0; a < still.length; a++) for (let b2 = a + 1; b2 < still.length; b2++) {
        mg = Math.min(mg, dist2D(still[a].pos, still[b2].pos));
      }
      if (mg === 99) mg = 9;
      // ハンドラーの周りに何人寄っているか（ボールに群がっていないか）
      {
        const h2 = game.handler;
        if (h2) {
          const near = off.filter((p) => p !== h2 && dist2D(p.pos, h2.pos) < 4.0).length;
          nearBall.push(near);
          if (dist2D(h2.pos, game.attackFloor(h2.team)) < THREE_DIST) nearBallIn.push(near);
        }
      }
      // コート幅を3分割して、各帯に何人居るか（左|中央|右）
      widthL.push(off.filter((p) => p.pos.x < -2.7).length);
      widthR.push(off.filter((p) => p.pos.x > 2.7).length);
      minGaps.push(mg);
      const cx = off.reduce((s, p) => s + p.pos.x, 0) / off.length;
      const cz = off.reduce((s, p) => s + p.pos.z, 0) / off.length;
      const sp = off.reduce((s, p) => s + Math.hypot(p.pos.x - cx, p.pos.z - cz), 0) / off.length;
      spreads.push(sp);
      if (mg < 2.0) clump++;
      // ハンドラーがアークの内側へ入った時
      const h = game.handler;
      if (h && dist2D(h.pos, game.attackFloor(h.team)) < THREE_DIST) {
        driveFrames++;
        if (mg < 2.0) driveClump++;
      }
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const mk = (a: Shot[]) => a.length ? pc(a.filter((s) => s.made).length, a.length) + "(" + a.length + "本)" : "-";

console.log(`${NG * SEEDS.length}試合  試投 ${shots.length}本`);
const bad = shots.filter((s) => (s.pts === 3) !== s.arc);
console.log(`\n■ 判定の食い違い（shotPoints と描画の線が一致しない）: ${bad.length}本 ${pc(bad.length, shots.length)}`);
for (const b of bad.slice(0, 5)) {
  console.log(`   |x|=${b.x.toFixed(2)} リムから${b.dz.toFixed(2)} 半径${b.r.toFixed(2)} → ${b.pts}P / 線の外=${b.arc}`);
}
const t3 = shots.filter((s) => s.pts === 3);
console.log(`\n■ 3P ${t3.length}本  成功率 ${mk(t3)}`);
console.log(`  角度別（|x| = コート中心からの横のずれ）`);
for (const [lo, hi, nm] of [[0, 2.5, "正面"], [2.5, 4.5, "やや斜め"], [4.5, 6.0, "ウイング"], [6.0, 99, "コーナー寄り"]] as [number, number, string][]) {
  const a = t3.filter((s) => s.x >= lo && s.x < hi);
  console.log(`    ${nm.padEnd(7)} ${mk(a).padEnd(16)} ラインからの距離 中央 ${med(a.map((s) => s.slack))}m / 守備 ${med(a.map((s) => s.def))}m`);
}
console.log(`  守備との距離（リリース時）`);
for (const [lo, hi, nm] of [[0, 1.0, "密着(1m内)"], [1.0, 1.6, "寄せている"], [1.6, 2.2, "やや遠い"], [2.2, 99, "フリー(2.2m超)"]] as [number, number, string][]) {
  const a2 = t3.filter((s2) => s2.def >= lo && s2.def < hi);
  console.log(`    ${nm.padEnd(12)} ${mk(a2).padEnd(16)} ラインから ${med(a2.map((s2) => s2.slack))}m`);
}
console.log(`  ラインからどれだけ外で打っているか`);
for (const [lo, hi] of [[0, 0.3], [0.3, 0.8], [0.8, 1.5], [1.5, 99]]) {
  const a = t3.filter((s) => s.slack >= lo && s.slack < hi);
  console.log(`    ${lo}〜${hi}m: ${mk(a)}`);
}
const corner = shots.filter((s) => s.x > 5.5 && s.dz < 3.0);
console.log(`\n■ コーナー領域(|x|>5.5 かつ リムから z 3m以内)の試投 ${corner.length}本`);
console.log(`   3Pとして数えた ${pc(corner.filter((s) => s.pts === 3).length, corner.length)} / 成功率 ${mk(corner)}`);
console.log(`   |x| 中央 ${med(corner.map((s) => s.x))} （コーナーの線は ${THREE_CORNER_X}）`);

console.log(`\n■ スペーシング（${frames}フレーム）`);
console.log(`  左右どちらかが**0人**: ${pc(oneSide, frames)}`);
console.log(`  5人の最小間隔 中央 ${med(minGaps)}m / 2m未満(団子) ${pc(clump, frames)}`);
console.log(`  重心からの広がり 中央 ${med(spreads)}m`);
console.log(`  ハンドラーがアークの内側に居る時の団子率: ${pc(driveClump, driveFrames)}（${driveFrames}フレーム）`);
const avg2 = (a: number[]) => a.length ? (a.reduce((s2, v) => s2 + v, 0) / a.length).toFixed(2) : "-";
console.log(`
■ ボールへの群がり（ハンドラーの4m以内に居る味方の人数）`);
console.log(`  常時 平均 ${avg2(nearBall)}人 / 2人以上 ${pc(nearBall.filter((v) => v >= 2).length, nearBall.length)}`);
console.log(`  ハンドラーがアークの内側に居る時 平均 ${avg2(nearBallIn)}人`
  + ` / 2人以上 ${pc(nearBallIn.filter((v) => v >= 2).length, nearBallIn.length)}`);
console.log(`
■ コート幅の使い方（|x|>2.7 を左右の帯とする）`);
console.log(`  左の帯 平均 ${avg2(widthL)}人 / 0人 ${pc(widthL.filter((v) => v === 0).length, widthL.length)}`);
console.log(`  右の帯 平均 ${avg2(widthR)}人 / 0人 ${pc(widthR.filter((v) => v === 0).length, widthR.length)}`);
console.log(`  どちらかの帯が0人 ${pc(widthL.map((v, i) => v === 0 || widthR[i] === 0 ? 1 : 0).reduce((s2: number, v) => s2 + v, 0), widthL.length)}`);
