// 変更前後を比べるための総合指標。3PA/コーナー占有/ゴール下の試投/得点をまとめて出す。
import "./stubs";
// ⚠️ 1つの種だけで比べない。シミュレーションはカオスなので、小さな変更でも試合展開が
//    丸ごと分岐する。複数の種で回して平均を見ること。
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
const NG = Number(process.env.NG ?? 8);
let fga = 0, fgm = 0, tpa = 0, tpm = 0, pts = 0;
let cornerFGA = 0, rimFGA = 0;
let frames = 0, cornerOcc = 0, twoCornerOcc = 0;
let lastShooter: Player | null = null;
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b").split(",").map((v) => Number(v) >>> 0);
for (const seed of SEEDS) {
for (let gi = 0; gi < NG; gi++) {
  setSeed((seed + gi * 0x9e3779b1) >>> 0);
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const p0 = new Map(all.map((p) => [p, { f: p.stats.fga, m: p.stats.fgm, t: p.stats.tpa, tm: p.stats.tpm, s: p.stats.pts }]));
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const before = game.shooter;
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== before && sh !== lastShooter) {
      lastShooter = sh;
      const rim = game.attackFloor(sh.team);
      const dz = Math.abs(sh.pos.z - rim.z);
      if (Math.abs(sh.pos.x) > 5.5 && dz < 3.0) cornerFGA++;
      if (dist2D(sh.pos, rim) < 2.5) rimFGA++;
    }
    if (!sh) lastShooter = null;
    if (game.frontT) {
      frames++;
      let n = 0;
      for (const p of game.teamPlayers(game.possession)) {
        const rim = game.attackFloor(p.team);
        if (Math.abs(p.pos.x) > 6.0 && Math.abs(p.pos.z - rim.z) < 3.5) n++;
      }
      if (n >= 1) cornerOcc++;
      if (n >= 2) twoCornerOcc++;
    }
  }
  for (const p of all) {
    const b = p0.get(p)!;
    fga += p.stats.fga - b.f; fgm += p.stats.fgm - b.m;
    tpa += p.stats.tpa - b.t; tpm += p.stats.tpm - b.tm; pts += p.stats.pts - b.s;
  }
}
}
const G = NG * SEEDS.length;
const per = (n: number) => (n / G / 2).toFixed(1);
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${G}試合（種 ${SEEDS.length}通り × ${NG}試合 / 1チーム1試合あたり）`);
console.log(`  得点 ${per(pts)}  FG ${per(fgm)}/${per(fga)} (${pc(fgm, fga)})`);
console.log(`  3P   ${per(tpm)}/${per(tpa)} (${pc(tpm, tpa)})   3PA比率 ${pc(tpa, fga)}`);
console.log(`  コーナーからの試投 ${per(cornerFGA)}本 / ゴール下(2.5m内) ${per(rimFGA)}本`);
console.log(`  コーナーに1人以上 ${pc(cornerOcc, frames)} / 2人 ${pc(twoCornerOcc, frames)}`);
