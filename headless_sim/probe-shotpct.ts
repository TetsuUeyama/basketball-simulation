// シュート成功率が距離とマークでどう変わるか。外れた球がどこへ落ちるか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D, dist2DTo } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 24);

type Cell = { n: number; made: number };
const mk = (): Cell => ({ n: 0, made: 0 });
const byDef: Record<string, Cell> = { "〜0.8m": mk(), "0.8〜1.5m": mk(), "1.5〜2.5m": mk(), "2.5m〜": mk() };
const three: Record<string, Cell> = { "〜0.8m": mk(), "0.8〜1.5m": mk(), "1.5〜2.5m": mk(), "2.5m〜": mk() };
const mid: Record<string, Cell> = { "〜0.8m": mk(), "0.8〜1.5m": mk(), "1.5〜2.5m": mk(), "2.5m〜": mk() };
const bucket = (d: number): string => d < 0.8 ? "〜0.8m" : d < 1.5 ? "0.8〜1.5m" : d < 2.5 ? "1.5〜2.5m" : "2.5m〜";
let all = mk(), all3 = mk(), allMid = mk();
let atRim = mk(), midJ = mk();   // リム至近(3m未満) と ミドルジャンパー(3m〜3Pライン)
// 外れた球の落下点（リムからの距離、横方向のずれ）
const landDist: number[] = [], landSide: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasShot = false, wasLoose = false, landed = false;
  let rimX = 0, rimZ = 0;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    game.update(DT);
    if (mode !== "shot" && game.ballMode === "shot" && game.shooter) {
      const sh = game.shooter;
      const rim = game.attackFloor(sh.team);
      const dh = dist2D(sh.pos, rim);
      let nd = Infinity;
      for (const d of game.teamPlayers(1 - sh.team)) nd = Math.min(nd, dist2D(d.pos, sh.pos));
      const b = bucket(nd);
      const made = game.shotMade ? 1 : 0;
      byDef[b].n++; byDef[b].made += made; all.n++; all.made += made;
      if (game.shotPoints === 3) { three[b].n++; three[b].made += made; all3.n++; all3.made += made; }
      else {
        mid[b].n++; mid[b].made += made; allMid.n++; allMid.made += made;
        if (dh < 3) { atRim.n++; atRim.made += made; } else { midJ.n++; midJ.made += made; }
      }
      rimX = rim.x; rimZ = rim.z;
    }
    // 外れてルーズになった球が最初に床へ着いた地点
    // ⚠️ リムは**そのリバウンドが始まった時**の攻撃側から取る。直前のシュートの
    //    値を使い回すと、反対側のリムから測ってしまう（中央 14m になっていた）。
    const loose = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (loose && !wasLoose) {
      const off = (game as unknown as { looseOff: number }).looseOff;
      const r2 = game.attackFloor(off);
      rimX = r2.x; rimZ = r2.z; landed = false;
    }
    if (loose && !landed) {
      landed = true;
      // ⚠️ 「実際に床へ着いた地点」で測ると、途中で誰かがはたいた球が混ざって
      //    弾道の評価にならない。**リムを離れた瞬間の速度から**落下点を計算する。
      const b0 = game.ball.pos, v0 = game.ball.vel;
      const disc = v0.y * v0.y + 2 * 9.0 * (b0.y - 0.12);
      const tf = disc > 0 ? (v0.y + Math.sqrt(disc)) / 9.0 : 0;
      const lx = b0.x + v0.x * tf, lz = b0.z + v0.z * tf;
      landDist.push(dist2DTo({ x: lx, y: 0, z: lz } as never, rimX, rimZ));
      landSide.push(Math.abs(lx - rimX));
    }
    wasLoose = loose;
    void wasShot;
  }
}
const pc = (c: Cell): string => c.n ? `${(c.made / c.n * 100).toFixed(0)}%（${c.made}/${c.n}）` : "標本なし";
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`${NG} 試合（各4分）`);
console.log(`全体 ${pc(all)} / 3P ${pc(all3)} / 2P ${pc(allMid)}`);
console.log(`  うち リム至近(3m未満) ${pc(atRim)} / ミドルジャンパー(3m〜) ${pc(midJ)}`);
console.log(`\n最寄り守備者までの距離ごとの成功率`);
for (const k of Object.keys(byDef)) {
  console.log(`  ${k.padEnd(11, "　")} 全体 ${pc(byDef[k]).padEnd(16, "　")} 3P ${pc(three[k]).padEnd(14, "　")} ミドル ${pc(mid[k])}`);
}
console.log(`\n外れた球が床に着いた地点`);
console.log(`  リムからの距離 中央 ${q(landDist, .5)}m  75% ${q(landDist, .75)}m  95% ${q(landDist, .95)}m`);
console.log(`  横方向のずれ   中央 ${q(landSide, .5)}m  75% ${q(landSide, .75)}m  95% ${q(landSide, .95)}m`);
console.log(`\n※ 実際のバスケット: 3P 約36% / 2P 約52%。ドフリーと密着で 10〜15 ポイント差。`);
