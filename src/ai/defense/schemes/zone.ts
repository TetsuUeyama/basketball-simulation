// ハーフコートゾーン(2-3 / 3-2)。man-match も PnR スイッチもせず、区域とボールを守る。
import { Player } from "../../../objects/player/player";
import { RIM } from "../../../config";
import { clamp, chance, dist2D, moveToward2D, rate } from "../../../util";
import { defHands, ballSecurity } from "../../../eval";
import { defEffort, getBackOnDefense } from "../shared";
import { defendOnBall } from "../vs-onball";
import type { Game } from "../../../game";
import { manOf } from "../shared";

// ゾーンの各守備者のホーム位置。
function zoneHomes(game: Game, defTeam: number, s: number): Map<Player, { x: number; z: number }> {
  const ds = game.teamPlayers(defTeam);
  const rimZ = s * RIM.z;
  const dir = -s;                              // ミッドコート方向
  const topN = game.zoneScheme === "3-2" ? 3 : 2;
  const order = [...ds].sort((a, b) => a.slot - b.slot);  // ガード優先
  const top = order.slice(0, topN);
  const back = order.slice(topN);
  const topXs = topN === 3 ? [-4.4, 0, 4.4] : [-2.9, 2.9];
  const backXs = back.length === 3 ? [-3.5, 0, 3.5] : [-2.9, 2.9];
  const topDepth = 6.9;
  const m = new Map<Player, { x: number; z: number }>();
  // 左右順を安定させ守備者が交差しないように
  top.sort((a, b) => a.pos.x - b.pos.x).forEach((d, i) =>
    m.set(d, { x: topXs[i], z: rimZ + dir * topDepth }));
  // ⚠️ **リムアンカーを必ず中央後方（リム上）に置く**。x順に並べるだけだと、リムを守る
  //    役が左右のベースラインへ流れてゴール下の正面が空く。
  const anc = back.length === 3 ? zoneRimAnchor(game, defTeam) : null;
  const rest = back.filter((d) => d !== anc).sort((a, b) => a.pos.x - b.pos.x);
  const order2 = anc && back.includes(anc) ? [rest[0], anc, rest[1]] : back.slice().sort((a, b) => a.pos.x - b.pos.x);
  order2.forEach((d, i) => {
    if (!d) return;
    const mid = back.length === 3 && i === 1;   // 中央後方はリム上
    m.set(d, { x: backXs[i], z: rimZ + dir * (mid ? 1.1 : 2.1) });
  });
  return m;
}

/**
 * ゾーンで**リムに残す1人**（区域内の相手にもボールにも釣り出されない）。
 * ⚠️ 以前は誰も固定されておらず、後ろの3人も区域内の相手へ 45〜60% 引っ張られていた。
 *    実測(36試合): ゾーンだとリム下(0〜3m)の攻撃選手への最寄り守備が **5.79m**
 *    （マンマークは 1.28m）、**リム下に守備が0人のフレームが 51.1%**（マンは 34.6%）。
 *    ゾーンなのにゴール下が無人、という状態だった。
 */
function zoneRimAnchor(game: Game, defTeam: number): Player | null {
  let best: Player | null = null, bv = -Infinity;
  for (const p of game.teamPlayers(defTeam)) {
    const v = (p.height - 1.9) * 2 + rate(p.attr.jump) * 0.6 + rate(p.attr.defense) * 0.4;
    if (v > bv) { bv = v; best = p; }
  }
  return best;
}
/** リムアンカーがボールへ出て良い距離（ハンドラーがこれより近ければ自分で守る）。 */
const ANCHOR_BALL_IN = 4.0;
/** リムアンカーが区域内の相手へ寄れる上限（これ以上はリムを離れない）。 */
const ANCHOR_CLAIM = 0.22;

export function runZoneDefense(game: Game, dt: number): void {
  const defTeam = 1 - game.possession;
  const s = game.attackSign(game.possession);
  const rim = game.attackFloor(game.possession);
  const defenders = game.teamPlayers(defTeam);
  const offense = game.teamPlayers(game.possession);
  const h = game.handler;
  const b = game.ball.pos;
  const homes = zoneHomes(game, defTeam, s);
  const shiftX = clamp(b.x * 0.4, -2.8, 2.8);        // ゾーン全体がボール側へスライド

  // ボールがある区域の守備者が前に出て圧力
  const anchor = zoneRimAnchor(game, defTeam);
  let ballDef: Player | null = null;
  if (h) {
    // ⚠️ リムアンカーは**ボールへ釣り出さない**。ハンドラーがペイントまで入って来た時だけ
    //    自分で守る。以前は「ハンドラーに最も近い守備者」で選んでいたので、後方のビッグが
    //    外のボールへ引き出されてリムが空いていた。
    const hRim = dist2D(h.pos, rim);
    let best = Infinity;
    for (const d of defenders) {
      if (d === anchor && hRim > ANCHOR_BALL_IN) continue;
      const dd = dist2D(d.pos, h.pos);
      if (dd < best) { best = dd; ballDef = d; }
    }
  }

  for (const d of defenders) {
    if (getBackOnDefense(game, dt, d, manOf(game, d) ?? offense[d.slot])) continue;   // まずトランジション
    d.decayLean(dt);

    if (d === ballDef && h) {
      // ゾーン内でボールに圧力(ソフトな man-up)、トップからつつく
      defendOnBall(game, dt, d, h, rim);
      const gap = dist2D(d.pos, h.pos);
      if (gap < 1.4) {
        const close = 1 - gap / 1.4;
        const stl = defHands(d);
        const resist = ballSecurity(h);
        if (chance(Math.max(0.004, 0.025 + stl * 0.08 - resist * 0.06) * close * dt)) { game.steal(d); return; }
      }
      continue;
    }

    const home = homes.get(d)!;
    let tx = home.x + shiftX, tz = home.z;
    // マッチアップ風味: 区域内のオフェンスを拾う。後方ビッグはアークの外まで追わない。
    // ⚠️ リムアンカーはゴール下の相手しか見ない（外の相手を拾いに行かない）。
    const reach = d === anchor ? 2.2 : game.isBig(d) ? 3.0 : 3.8;
    let claim: Player | null = null;
    let bestD = reach;
    for (const o of offense) {
      if (o === h) continue;
      const dd = Math.hypot(o.pos.x - (home.x + shiftX), o.pos.z - home.z);
      if (dd < bestD) { bestD = dd; claim = o; }
    }
    if (claim) {
      // 区域内の男へクローズアウトしつつゾーンの深さを保つ(ペイントを空けない)
      // ⚠️ リムアンカーだけは**ほとんど動かない**。ここを普通に引っ張ると、後ろの3人が
      //    同時に外を向いてゴール下が無人になる。
      const pull = d === anchor ? ANCHOR_CLAIM : 1;
      tx = home.x + shiftX + (claim.pos.x - (home.x + shiftX)) * 0.6 * pull;
      tz = home.z + (claim.pos.z - home.z) * 0.45 * pull;
    }
    // ボールがペイントへドライブしてきたらリムをヘルプ
    if (h && (h.beatenT > 0 || h.powerT > 0) && game.isBig(d) && dist2D(h.pos, rim) < 6) {
      tx = (tx + rim.x) / 2; tz = (tz + rim.z) / 2;
    }
    const effort = defEffort(game, d, rim);
    moveToward2D(d.pos, tx, tz, d.accelToward(dt, tx, tz, effort) * dt);
    game.clampCourt(d.pos);
  }
}
