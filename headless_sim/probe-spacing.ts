// 得点の内訳とスペーシング。攻撃側がどれだけ広がり、守備がどれだけ寄っているか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 24);

let pts = 0, fga = 0, fgm = 0;
let rimA = 0, rimM = 0, midA = 0, midM = 0, thrA = 0, thrM = 0;
let dunks = 0, passes = 0;
let rimFeed = 0;          // 受け手がゴール下(3.4m以内)だったパス
let openRimFrames = 0, heldFrames = 0;   // ゴール下でフリーな味方が居たフレーム
let cutFrames = 0;        // 誰かがカット中のフレーム
let bringPass = 0, setPass = 0;    // ボール運び中 / 組み立て中 のパス
const bringT: number[] = [];       // 保持開始から組み立てに入るまでの秒
let bringing = 0;
const nearCenter: number[] = [];   // センターサークル付近(中央から4m以内)に居る攻撃側の人数
const inPaintOff: number[] = [];   // ペイント内に居る攻撃側の人数
const distRim: number[] = [];      // 攻撃側5人のリムまでの距離
const handlerZ: number[] = [];     // ハンドラーのリムまでの距離
const spread: number[] = [];     // 攻撃側5人の相互距離の平均
const paintDef: number[] = [];   // ペイント内の守備人数
const openMate: number[] = [];   // ハンドラー以外で、最寄り守備者が 2m 以上離れている味方の数
const rimHelp: number[] = [];    // ゴール下 3m 以内の守備人数
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    game.update(DT);
    if (mode !== "shot" && game.ballMode === "shot" && game.shooter) {
      const sh = game.shooter;
      const rim = game.attackFloor(sh.team);
      const dh = dist2D(sh.pos, rim);
      fga++;
      const made = game.shotMade ? 1 : 0; fgm += made;
      if (game.shotPoints === 3) { thrA++; thrM += made; }
      else if (dh < 3) { rimA++; rimM += made; }
      else { midA++; midM += made; }
      if ((game as unknown as { shotWasDunk: boolean }).shotWasDunk) dunks++;
    }
    if (mode !== "pass" && game.ballMode === "pass") {
      passes++;
      const fr = !!(game as unknown as { frontT: number }).frontT
        && !!game.passer && dist2D(game.passer.pos, game.attackFloor(game.passer.team)) < 12;
      if (fr) setPass++; else bringPass++;
      const to = game.passTo;
      if (to && dist2D(to.pos, game.attackFloor(to.team)) < 3.4) rimFeed++;
    }
    // 攻撃が組み立てている間だけスペーシングを見る
    // ⚠️ ボール運びの時間を除く。フロントコートで確立し、ハンドラーがハーフを
    //    越えてからだけを「組み立て中」とする。
    const front = !!(game as unknown as { frontT: number }).frontT
      && !!game.handler && dist2D(game.handler.pos, game.attackFloor(game.possession)) < 12;
    if (game.ballMode === "held" && game.handler) {
      if (front) { if (bringing > 0) { bringT.push(bringing * DT); bringing = 0; } }
      else bringing++;
    } else bringing = 0;
    if (game.ballMode === "held" && game.handler && front && i % 15 === 0) {
      const off = game.teamPlayers(game.possession).filter((p) => !p.seated).slice(0, 5);
      const def = game.teamPlayers(1 - game.possession).filter((p) => !p.seated).slice(0, 5);
      let sum = 0, cnt = 0;
      for (let a = 0; a < off.length; a++) for (let b = a + 1; b < off.length; b++) {
        sum += dist2D(off[a].pos, off[b].pos); cnt++;
      }
      if (cnt) spread.push(sum / cnt);
      const rim = game.attackFloor(game.possession);
      let inPaint = 0, nearRim = 0;
      for (const d of def) {
        if (dist2D(d.pos, rim) < 4.2 && Math.abs(d.pos.x) < 2.5) inPaint++;
        if (dist2D(d.pos, rim) < 3) nearRim++;
      }
      paintDef.push(inPaint); rimHelp.push(nearRim);
      heldFrames++;
      for (const o of off) {
        if (o === game.handler) continue;
        if (dist2D(o.pos, rim) >= 3.4) continue;
        let help = 0;
        for (const d of def) if (dist2D(d.pos, o.pos) < 2.2) help++;
        if (help <= 1) { openRimFrames++; break; }
      }
      if (off.some((o) => o.cutting)) cutFrames++;
      let nc = 0, ip = 0;
      for (const o of off) {
        if (Math.hypot(o.pos.x, o.pos.z) < 4) nc++;
        if (dist2D(o.pos, rim) < 4.2 && Math.abs(o.pos.x) < 2.5) ip++;
        distRim.push(dist2D(o.pos, rim));
      }
      nearCenter.push(nc); inPaintOff.push(ip);
      if (game.handler) handlerZ.push(dist2D(game.handler.pos, rim));
      let open = 0;
      for (const o of off) {
        if (o === game.handler) continue;
        let nd = Infinity;
        for (const d of def) nd = Math.min(nd, dist2D(d.pos, o.pos));
        if (nd >= 2) open++;
      }
      openMate.push(open);
    }
  }
  pts += game.score[0] + game.score[1];
}
const avg = (a: number[]): string => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "-";
const pc = (m: number, a: number): string => a ? `${(m / a * 100).toFixed(0)}%（${m}/${a}）` : "0本";
console.log(`${NG} 試合（各4分）`);
console.log(`1試合あたり 得点 ${(pts / NG).toFixed(1)} / 試投 ${(fga / NG).toFixed(1)} / パス ${(passes / NG).toFixed(1)}`);
console.log(`  ゴール下(3m未満) ${pc(rimM, rimA)}  ${(rimA / NG).toFixed(1)}本/試合`);
console.log(`  ミドル           ${pc(midM, midA)}  ${(midA / NG).toFixed(1)}本/試合`);
console.log(`  3P               ${pc(thrM, thrA)}  ${(thrA / NG).toFixed(1)}本/試合`);
console.log(`  ダンク ${dunks} 本（${(dunks / NG).toFixed(2)}/試合）`);
console.log(`\n組み立て中のスペーシング`);
console.log(`  攻撃5人の相互距離 平均 ${avg(spread)}m`);
console.log(`  ペイント内の守備人数 平均 ${avg(paintDef)} 人`);
console.log(`  ゴール下3m以内の守備人数 平均 ${avg(rimHelp)} 人`);
console.log(`  フリー(最寄り守備2m以上)な味方 平均 ${avg(openMate)} 人`);
console.log(`
機会と実行`);
console.log(`  ゴール下にフリーな味方が居たフレーム ${openRimFrames} / ${heldFrames}`
  + `（${(openRimFrames / Math.max(1, heldFrames) * 100).toFixed(0)}%）`);
console.log(`  誰かがカット中だったフレーム ${cutFrames} / ${heldFrames}`
  + `（${(cutFrames / Math.max(1, heldFrames) * 100).toFixed(0)}%）`);
console.log(`  ゴール下への配球 ${rimFeed} 本 / パス ${passes} 本（${(rimFeed / Math.max(1, passes) * 100).toFixed(1)}%）`);
console.log(`
攻撃側の居場所（組み立て中）`);
console.log(`  センターサークル付近(コート中央4m以内)の人数 平均 ${avg(nearCenter)} 人`);
console.log(`  ペイント内の人数 平均 ${avg(inPaintOff)} 人`);
console.log(`  リムまでの距離 平均 ${avg(distRim)}m / ハンドラー ${avg(handlerZ)}m`);
console.log(`
ボール運びと組み立て`);
console.log(`  組み立てに入るまでの時間 平均 ${avg(bringT)}秒（${bringT.length} 回）`);
console.log(`  ボール運び中のパス ${bringPass} 本 / 組み立て中のパス ${setPass} 本`);
