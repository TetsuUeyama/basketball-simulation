// 攻撃移行の実測。
//  ① 運び上げ中(!frontT)に、攻撃側オフボールが**攻めるリムから遠ざかる向き**へ
//     命令されているフレームを呼び出し元(site)別に数える。
//  ② 攻撃移行中の移動速度（走力に対する比）を攻守で比べる。
//  ③ 守備: マークとの距離を、マークのリム距離帯で分ける。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D, dist2DTo, MOVE_TRACE, MOVE_LOG } from "../src/util";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);

const back = new Map<string, number>();
const setup: number[] = [];   // ポゼッション開始から攻撃陣形が整うまでの秒数
let advN = 0, advSpd = 0, advRun = 0;      // 攻撃移行中の攻撃側
let getN = 0, getSpd = 0, getRun = 0;      // 守備へ戻る側
const markBand: Record<string, { n: number; sum: number; near: number; dr: number; s3: number; s3near: number }> = {};
const BANDS: [string, number, number][] = [
  ["〜4.5m(ペイント/得点圏)", 0, 4.5], ["4.5〜6.75m(アーク内)", 4.5, THREE_DIST],
  ["6.75〜7.5m(ライン直上)", THREE_DIST, 7.5], ["7.5〜9m", 7.5, 9], ["9m超", 9, 99],
];
for (const [nm] of BANDS) markBand[nm] = { n: 0, sum: 0, near: 0, dr: 0, s3: 0, s3near: 0 };

MOVE_TRACE.site = true;   // on/off は毎フレーム切り替える（スタック取得が重い）
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let poss = -1, pt = 0, done = true;
  for (let i = 0; i < 60 * 60 * 8; i++) {
    // 運び上げ中だけトレースする
    MOVE_TRACE.on = !game.frontT;
    if (MOVE_TRACE.on) MOVE_LOG.clear();
    game.update(DT);
    const off = game.possession, def = 1 - off;
    if (off !== poss) { poss = off; pt = 0; done = false; }
    pt += DT;
    if (!done) {
      const r = game.attackFloor(off);
      const inPos = game.teamPlayers(off).filter((q) => q !== game.handler
        && dist2D(q.pos, r) < 8.0).length;
      if (inPos >= 4) { setup.push(pt); done = true; }
      else if (pt > 12) done = true;   // 整わないまま終わった
    }
    const oRim = game.attackFloor(off);
    const s = game.attackSign(off);
    // ① 運び上げ中の後退命令
    if (!game.frontT) {
      for (const p of game.teamPlayers(off)) {
        if (p === game.handler) continue;
        const a = MOVE_LOG.get(p.pos);
        if (!a) continue;
        for (const m of a) {
          // 目標が自分より「攻めるリムから遠い」= 後退
          if ((m.tx - p.pos.x) * 0 + (m.tz - p.pos.z) * s < -0.05) {
            back.set(m.site, (back.get(m.site) ?? 0) + 1);
          }
        }
      }
    }
    // ② 攻撃移行/守備復帰の速度
    if (!game.frontT) {
      for (const p of game.teamPlayers(off)) {
        if (p === game.handler || dist2D(p.pos, oRim) < 9) continue;
        advN++; advSpd += p.curSpd; advRun += p.runSpeed;
      }
      for (const p of game.teamPlayers(def)) {
        if (dist2DTo(p.pos, game.attackFloor(def).x, game.attackFloor(def).z) < 9) continue;
        getN++; getSpd += p.curSpd; getRun += p.runSpeed;
      }
    }
    // ③ 守備者と**自分の担当**の距離
    if (i % 30 === 0 && game.frontT) {
      const dRim = game.attackFloor(off);
      const offP = game.teamPlayers(off);
      for (const d of game.teamPlayers(def)) {
        const man = offP[d.slot];
        if (!man || man === game.handler) continue;
        const mr = dist2D(man.pos, dRim);
        const gap = dist2D(d.pos, man.pos);
        const s3 = man.attr.threeAcc >= 82;
        for (const [nm, lo, hi] of BANDS) {
          if (mr >= lo && mr < hi) {
            const b = markBand[nm];
            b.n++; b.sum += gap; if (gap < 2) b.near++;
            b.dr += dist2DTo(game.attackFloor(def), d.pos.x, d.pos.z);
            if (s3) { b.s3++; if (gap < 2) b.s3near++; }
          }
        }
      }
    }
  }
}
MOVE_TRACE.on = false;
console.log(`${NG}試合`);
setup.sort((a, b) => a - b);
const md = setup.length ? setup[Math.floor(setup.length / 2)] : 0;
console.log(`
⓪ ポゼッション開始から4人が攻撃位置(リム8m内)に揃うまで: 中央 ${md.toFixed(2)}秒 / ${setup.length}回`);
console.log("\n① 運び上げ中(!frontT)に**後退**を命じた呼び出し元:");
[...back.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([k, v]) => console.log(`  ${k || "(不明)"}: ${v}`));
console.log(`\n② 移行中の速度（リムから9m超に居る間）:`);
console.log(`  攻撃側: 平均 ${(advSpd / Math.max(1, advN)).toFixed(2)} m/s / 走力 ${(advRun / Math.max(1, advN)).toFixed(2)} → ${(advSpd / Math.max(1, advSpd && advRun) * 100).toFixed(0)}%`);
console.log(`  守備側: 平均 ${(getSpd / Math.max(1, getN)).toFixed(2)} m/s / 走力 ${(getRun / Math.max(1, getN)).toFixed(2)} → ${(getSpd / Math.max(1, getSpd && getRun) * 100).toFixed(0)}%`);
console.log("\n③ 攻撃側のリム距離帯ごとの、最寄り守備との距離:");
for (const [nm] of BANDS) {
  const b = markBand[nm];
  if (!b.n) { console.log(`  ${nm}: 標本なし`); continue; }
  console.log(`  ${nm}: ${b.n}件 / 担当との距離 ${(b.sum / b.n).toFixed(2)}m / 2m以内 ${(b.near / b.n * 100).toFixed(0)}%`
    + ` / 守備者のリム距離 ${(b.dr / b.n).toFixed(2)}m`
    + ` / うち3Pシューター ${b.s3}件(2m以内 ${b.s3 ? (b.s3near / b.s3 * 100).toFixed(0) : 0}%)`);
}
