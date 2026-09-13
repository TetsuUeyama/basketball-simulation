// ブロックの「効果」= 誰がどれだけ止められるか、をかわせるか、の確率算出（判定ルール）。
// 状態は変更しない純粋関数。抽選(chance)と状態変更(evade/jump/shotMade)は game.ts 側に残す。
import { Player } from "../../objects/player/player";
import { rate, clamp, dist2D } from "../../util";
import { palmRadius, leapHeight } from "../../eval";

/**
 * 跳んで手が届く高さ(m)。ブロッカーは跳び切り、シューターはリリースのために
 * 跳ぶぶんの一部しか使えない（放つ動作に高さを使い切らない）。
 */
export function reachOver(def: Player, shooter: Player): number {
  return reachTop(def, false) - reachTop(shooter, true);
}
function reachTop(p: Player, shooter: boolean): number {
  return p.height * 1.35 + leapHeight(p) * (shooter ? SHOOTER_LIFT : 1);
}
/** シューターがリリース時に使えるジャンプの割合。 */
const SHOOTER_LIFT = 0.55;
/** 到達点の差 1m あたり、ブロック確率へどれだけ効かせるか。 */
const REACH_GAIN = 0.95;
/** 到達点の差で足せる/引ける上限。 */
const REACH_CAP = { lo: -0.30, hi: 0.60 };

/**
 * 背後（追走）からのブロック。
 * ⚠️ 以前は距離(dist2D)だけで候補を選んでいたので、**進路に立ちはだかる守備者と
 *    後ろから追ってきた守備者が同じ確率**だった。実際のバスケットで背後のブロックが
 *    難しいのは ①シューターの体がボールを隠す ②下降に入った球はゴールテンディング
 *    ③追走側はリリースに間に合わない、の3点。チェイスダウンは実在するが稀。
 * lo/hi: シューター→リムの向きとの cos。lo 以上＝正面扱い(減衰なし)、hi で背後度1。
 * cut:   背後度1のときに削る割合。
 * chase: 明確に速く詰めている(チェイスダウン)ぶん戻る割合。
 * foul/fDef: 背後で手が出たとき、ブロックでなくファウルになる確率（守判断が高いほど低い）。
 */
const BEHIND = { lo: -0.2, hi: -1.0, cut: 0.75, chase: 0.45, spd: 2.5, foul: 0.55, fDef: 0.30 };

/**
 * 完全に叩き落とせた（スワット）か、手が当たってシュートコースを乱しただけか。
 * ⚠️ ボールを掴み取るように叩けるのは、**跳んだ手がリリース点の明確に上へ出た**時だけ。
 *    届いてはいるが上へ出ていない手は、触れてコースを乱す（＝外れてリバウンドになる）。
 * neutral/span: 到達点差 over の実測分布（ブロック成立時で 中央 0.39m / 25% 0.31 / 75% 0.49）
 *    に合わせる。neutral 以下は加点ゼロ、neutral+span で満点。
 */
const CLEAN = { base: 0.10, reach: 0.55, close: 0.25, air: 0.12, neutral: 0.30, span: 0.35, behind: 0.8 };
function cleanChance(over: number, close: number, airborne: boolean, behind: number): number {
  const lift = clamp((over - CLEAN.neutral) / CLEAN.span, 0, 1);
  return clamp((CLEAN.base + lift * CLEAN.reach + close * CLEAN.close
    + (airborne ? CLEAN.air : 0)) * (1 - behind * CLEAN.behind), 0, 0.9);
}

/** シューター→リムの向きに対する「背後度」。0 = 正面/横、1 = 真後ろ。 */
export function behindAmount(
  def: Player, shooter: Player, rim: { x: number; z: number },
): number {
  const rx = rim.x - shooter.pos.x, rz = rim.z - shooter.pos.z;
  const rl = Math.hypot(rx, rz);
  const bx = def.pos.x - shooter.pos.x, bz = def.pos.z - shooter.pos.z;
  const bl = Math.hypot(bx, bz);
  if (rl < 1e-3 || bl < 1e-3) return 0;
  const cos = (rx / rl) * (bx / bl) + (rz / rl) * (bz / bl);
  return clamp((BEHIND.lo - cos) / (BEHIND.lo - BEHIND.hi), 0, 1);
}

/** 背後から手を出したとき、クリーンなブロックでなく腕を叩くファウルになる確率。 */
export function behindFoulChance(def: Player, behind: number): number {
  return clamp(behind * (BEHIND.foul - rate(def.attr.defense) * BEHIND.fDef), 0, 0.6);
}

// このショットを最も止められる守備者とそのブロック確率を返す（抽選はしない）。
// isFinish=リム下フィニッシュか / shotWindup=溜め時間 / palmHitbox=手のひら判定モデルの有効フラグ。
// rim=シューターが攻めるリムの床位置（背後判定に使う）。
export function bestBlocker(
  defenders: Player[], shooter: Player, isFinish: boolean,
  shotWindup: number, palmHitbox: boolean, rim: { x: number; z: number },
): { def: Player; p: number; behind: number; clean: number } | null {
  const baseRange = isFinish ? 2.1 : 1.7;
  // 長い溜めほどブロック確率が上がる（守備が構えて跳べる）。素早いキャッチ&シュートは窓が狭い。
  const windupEdge = isFinish ? 0 : clamp(shotWindup - 0.3, 0, 0.8);
  let best: Player | null = null;
  let bestP = 0;
  let bestBehind = 0;
  let bestClean = 0;
  for (const d of defenders) {
    const dd = dist2D(d.pos, shooter.pos);
    // スワットのリーチ = 手のひら当たり判定（守備 vs オフェンスでサイズ可変）。無効時は固定。
    const range = palmHitbox
      ? (isFinish ? 1.35 : 1.05) * palmRadius(d, shooter)
      : baseRange;
    if (dd > range) continue;
    const blk = isFinish
      ? rate(d.attr.jump) * 0.4 + rate(d.attr.dunk) * 0.35 + rate(d.attr.defense) * 0.25
      : rate(d.attr.jump) * 0.42 + rate(d.attr.reaction) * 0.3 + rate(d.attr.defense) * 0.28;
    const close = 1 - dd / range;              // 1 = 密着, 0 = 端
    // ⚠️ 身長だけでなく**跳んで届く高さの差**で見る。高さもジャンプ力も効き、
    //    低身長のシューターは押さえ込まれやすくなる。
    //    （旧: 身長差 × 0.9 を ±0.25/0.4 で頭打ち）
    const over = reachTop(d, false) - reachTop(shooter, true);
    const reachAdv = clamp(over * REACH_GAIN, REACH_CAP.lo, REACH_CAP.hi);
    let p = (isFinish ? 0.34 : 0.27) * (0.2 + blk * 1.35) * close + reachAdv * close;
    p += windupEdge * (0.18 + blk * 0.2) * close;   // 遅い溜めほど止められやすい
    // 既に空中（溜めを読んで跳ね上がった）: 手がシュートポケットの真上でピーク
    if (d.airborne) p += 0.18 * close;
    // 早く跳びすぎた男は落ち/構え直し中でほぼコンテストにならない
    else if (d.landT > 0) p *= 0.3;
    // 弾道高さ: 高い虹のジャンパーはコンテストを越える（リム下は別動作で対象外）
    if (!isFinish) p *= clamp(1.5 - rate(shooter.attr.bank), 0.5, 1.5);
    // 背後（追走）は届かない。明確に速く詰めている時だけチェイスダウンとして戻す。
    const behind = behindAmount(d, shooter, rim);
    if (behind > 0) {
      const chase = clamp((d.curSpd - shooter.curSpd) / BEHIND.spd, 0, 1);
      p *= 1 - behind * BEHIND.cut * (1 - chase * BEHIND.chase);
    }
    p = clamp(p, 0, 0.85);
    if (p > bestP) {
      bestP = p; best = d; bestBehind = behind;
      bestClean = cleanChance(over, close, d.airborne, behind);
    }
  }
  return best ? { def: best, p: bestP, behind: bestBehind, clean: bestClean } : null;
}

// イベイド（ダブルクラッチ）でブロックをかわす確率 — フィニッシュ限定。S技術＋敏捷性で
// 上がり、ブロッカーのヘッドと身長差で下がる。
export function evadeBlockProbability(shooter: Player, blocker: Player): number {
  return clamp(
    rate(shooter.attr.shotTech) * 0.5 + rate(shooter.attr.agility) * 0.25
    - rate(blocker.attr.dunk) * 0.2
    - Math.max(0, blocker.height - shooter.height) * 0.5
    - 0.12,
    0.03, 0.7);
}
