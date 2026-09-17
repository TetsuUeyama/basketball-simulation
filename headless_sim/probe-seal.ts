// (A) ゴール下の押し合い: 守備は弾かず「ゴールから遠ざける」向きに押し込めているか。
//   ①攻撃側ポストのリムからの距離 ②その守備との距離 ③ゴール下の試投と成功率
//   ④押し合いで攻撃側がリムから離れた/近づいた量（1接触あたり）
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
const NG = Number(process.env.NG ?? 8);

const postRim: number[] = [];      // 攻撃側ポストのリムからの距離
const postDef: number[] = [];      // その最寄り守備との距離
let postFree = 0, postN = 0;       // 守備が 1.5m 超 = フリー
let rimFGA = 0, rimFGM = 0;
const shoveDrift: number[] = [];   // 押し合い中、攻撃側ポストの「リムからの距離」の1フレーム変化(cm)
const prevRim = new Map<Player, number>();
let lastShooter: Player | null = null;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const before = game.shooter;
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== before && sh !== lastShooter) {
      lastShooter = sh;
      if (dist2D(sh.pos, game.attackFloor(sh.team)) < 2.5) { rimFGA++; if (game.shotMade) rimFGM++; }
    }
    if (!sh) lastShooter = null;
    if (!game.frontT) continue;
    const post = game.postAnchor(game.possession);
    if (!post) continue;
    const rim = game.attackFloor(post.team);
    const dr = dist2D(post.pos, rim);
    const nd = game.nearestDefender(post);
    const dd = nd ? dist2D(post.pos, nd.pos) : 9;
    if (i % 6 === 0) {
      postN++; postRim.push(dr); postDef.push(dd);
      if (dd > 1.5) postFree++;
    }
    // 接触中（守備が 1.0m 以内）のリム距離の変化 = 押し合いの向き
    const pv = prevRim.get(post);
    if (pv !== undefined && dd < 1.0) shoveDrift.push((dr - pv) * 100);
    prevRim.set(post, dr);
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const avg = (a: number[]) => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(3) : "-";
console.log(`${NG}試合  攻撃側ポスト ${postN}サンプル`);
console.log(`  リムからの距離 中央値 : ${med(postRim)}m`);
console.log(`  最寄り守備との距離    : ${med(postDef)}m`);
console.log(`  フリー(守備1.5m超)    : ${pc(postFree, postN)}`);
console.log(`\n■ 押し合い中(守備1.0m以内 ${shoveDrift.length}フレーム)のリム距離の変化`);
console.log(`  平均 ${avg(shoveDrift)} cm/フレーム  （正=ゴールから遠ざかる / 負=ゴールへ寄る）`);
console.log(`  遠ざかったフレーム ${pc(shoveDrift.filter((v) => v > 0.05).length, shoveDrift.length)}`
  + ` / 寄ったフレーム ${pc(shoveDrift.filter((v) => v < -0.05).length, shoveDrift.length)}`);
console.log(`\n■ ゴール下(2.5m内)の試投 ${(rimFGA / NG / 2).toFixed(1)}本/チーム  成功率 ${pc(rimFGM, rimFGA)}`);
