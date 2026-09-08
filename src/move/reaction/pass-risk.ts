// パスの「効果」= レーン妨害・インターセプト確率の算出（判定ルール）。状態は変更
// しない純粋関数。`defenders` には from(パサー)の相手チームを渡す。
import { Player } from "../../objects/player/player";
import { LANE_W } from "../../config";
import type { PassStyle } from "../../config";
import { rate, clamp, dist2D, chance, segPerp } from "../../util";
import { passZip, passHeightAt, passReleaseY, reachFactor, leapHeight } from "../../eval";

// パスレーンに最も入り込んでいる守備者（レーン中央付近、両端に寄っていない者）を返す。
export function laneBlock(
  defenders: Player[], from: Player, to: Player,
): { def: Player; perp: number; t: number } | null {
  let best: { def: Player; perp: number; t: number } | null = null;
  for (const d of defenders) {
    const { t, perp } = segPerp(from.pos.x, from.pos.z, to.pos.x, to.pos.z, d.pos.x, d.pos.z);
    if (t <= 0.12 || t >= 0.92) continue;             // パサー/受け手の真横
    if (perp > LANE_W) continue;                      // レーン外
    if (!best || perp < best.perp) best = { def: d, perp, t };
  }
  return best;
}

// レーンの最脅威守備者にパスがカットされる確率。守備がどれだけレーン中央に座るか、
// パス距離(遠いほど滞空)、守備のボールへの嗅覚(反応/守判断)、パサーの精度(P精度は
// 同じ隙間により細い窓を通す)、パス速度(P速度=速い球ほど跳びづらい)を合成。
export function interceptChance(
  from: Player, to: Player, block: { def: Player; perp: number; t: number },
  style: PassStyle = "chest",
): number {
  // 高さの帯: 守備者の位置でボールが手の届く高さを通らなければ触れない。
  // バウンズは手の下、オーバーヘッドは指先の上を抜ける。
  const reach = reachAt(from, block, style);
  if (reach <= 0) return 0;
  const d = dist2D(from.pos, to.pos);
  const inLane = 1 - block.perp / LANE_W;                       // 0 レーン端 .. 1 ど真ん中
  const distFactor = clamp(d / 11, 0.45, 1.25);
  const hawk = rate(block.def.attr.reaction) * 0.45 + rate(block.def.attr.defense) * 0.35
    + rate(block.def.attr.agility) * 0.2
    + (block.def.has("interceptor") ? 0.18 : 0);                // スライディング
  const skill = rate(from.attr.passAcc);
  const zip = 1.18 - rate(from.attr.passSpd) * 0.45;            // 速いパスは切りづらい
  const angle = from.has("outside") ? 0.8 : 1;                  // アウトサイド: 変な角度
  let p = inLane * (0.45 + hawk * 0.6) * distFactor * zip * angle - skill * 0.3;
  p += Math.max(0, d - 10) * 0.06;   // 遠投は滞空する — 誰でも跳べる
  return clamp(p, 0, 0.9) * reach;
}

// 守備者が立っている地点でのボール高さから、その守備者の手の届き具合(0..1)を返す。
export function reachAt(
  from: Player, block: { def: Player; perp: number; t: number }, style: PassStyle,
): number {
  const y = passHeightAt(style, block.t, passReleaseY(style), 1.0);
  return reachFactor(block.def, y);
}

// 種別ごとのカット危険度。パサーが「どの投げ方なら通るか」を比べるために使う。
export function styleRisk(
  defenders: Player[], from: Player, to: Player, style: PassStyle,
): number {
  const block = laneBlock(defenders, from, to);
  let r = block ? interceptChance(from, to, block, style) : 0;
  const d = dist2D(from.pos, to.pos);
  const fade = d > 12 ? clamp(1 - (d - 12) * 0.05, 0.85, 1) : 1;
  const flightT = d / Math.max(1, passZip(from) * fade);
  // 走り込んでくる相手のぶんも見積もる。⚠️ ここを入れないと、パサーは「いま
  //    レーンに居るか」しか見ず、動いてカットしに来る相手の前へ投げてしまう。
  //    どれだけ読めるかは P精度（低い選手は過小評価する）。
  const foresee = 0.45 + rate(from.attr.passAcc) * 0.55;
  r += (closingBest(defenders, from, to, flightT, style)?.p ?? 0) * foresee;
  if (d > 9) r += (longBallBest(defenders, from, to, flightT, d, style)?.p ?? 0) * 0.9;
  return r;
}

// 最も通る投げ方を選ぶ。バウンズは床で減速するので近〜中距離のみ、
// オーバーヘッドは至近の圧下では持ち上げる間に叩かれるので候補から外す。
export function bestPassStyle(
  defenders: Player[], from: Player, to: Player,
): { style: PassStyle; risk: number } {
  const d = dist2D(from.pos, to.pos);
  let nearest = Infinity;
  for (const df of defenders) nearest = Math.min(nearest, dist2D(df.pos, from.pos));
  const cands: PassStyle[] = [];
  if (d > 9 && nearest > 1.4) cands.push("overhead");   // 遠投は頭上から(同リスクなら優先)
  cands.push("chest");
  if (d <= 9) cands.push("bounce");                     // 近〜中距離は床で手の下をくぐらせる
  let best: { style: PassStyle; risk: number } = { style: "chest", risk: Infinity };
  for (const s of cands) {
    const r = styleRisk(defenders, from, to, s);
    if (r < best.risk) best = { style: s, risk: r };
  }
  return best;
}

// ロングボールの読み: ~9m 超のパスは滞空し、飛行経路上の点にボールより先に走り込める
// 守備者はカットのチャンスを持つ。スライディング持ちは早く抜け出す。
export function longBallBest(
  defenders: Player[], from: Player, to: Player, flightT: number, flightDist: number,
  style: PassStyle = "chest",
): { def: Player; at: number; p: number } | null {
  const hang = clamp((flightDist - 9) / 6, 0, 1);   // 9m→0, 15m→1
  let best: { def: Player; at: number; p: number } | null = null;
  for (const df of defenders) {
    const { t, perp } = segPerp(from.pos.x, from.pos.z, to.pos.x, to.pos.z, df.pos.x, df.pos.z);
    if (t <= 0.15 || t >= 0.88) continue;
    // ボールが自分の点を横切る前に稼げる距離（スライディング持ちは先手）
    const cover = df.runSpeed * 0.85 * (flightT * t) * (df.has("interceptor") ? 1.35 : 1);
    if (perp > cover + 0.4) continue;               // 単純に届かない
    // ⚠️ ここは**ボールの高さを見ていなかった**。実測でバウンズパスのカット 22 本中
    //    18 本がこの経路で、床を這う球を普通のロブと同じように読んで奪っていた。
    //    その地点のボールの高さで手の届き具合を掛ける。走り込みながら低い球へ手を
    //    下ろすのは難しいので、低いほど厳しくする。
    const y = passHeightAt(style, t, passReleaseY(style), 1.0);
    const spare = flightT * t - perp / Math.max(0.5, df.runSpeed * 0.85);
    const reach = closeReach(df, y, spare);
    if (reach <= 0) continue;
    let p = 0.35 + hang * 0.3 + rate(df.attr.reaction) * 0.2
      - rate(from.attr.passAcc) * 0.2;
    if (df.has("interceptor")) p += 0.2;
    p = clamp(p, 0.05, 0.85) * reach;
    if (!best || p > best.p) best = { def: df, at: t, p };
  }
  return best;
}

// ロングボールが実際に読まれてカットされたか（一度だけ抽選）。
export function longBallRead(
  defenders: Player[], from: Player, to: Player, flightT: number, flightDist: number,
  style: PassStyle = "chest",
): { def: Player; at: number; reach: number } | null {
  const best = longBallBest(defenders, from, to, flightT, flightDist, style);
  // 走り込んで正面で捕るので、手は完全に届いている
  if (best && chance(best.p)) { CUT_SOURCE.last = "ロングボール読み"; return { def: best.def, at: best.at, reach: 1 }; }
  return null;
}

// 確率以前の幾何ルール: パスレーンのど真ん中に守備が立っていたらそのパスは通らない。
// ただしその投げ方が守備者の手の届く高さを外すなら(バウンズ/オーバーヘッド)通してよい。
/**
 * すでにパスレーンに立っている相手が居れば、そのパスは出さない（出せない）。
 * ⚠️ 以前は「レーン中央から 0.65m 以内」だけを拒否していた。レーン幅は 1.1m なので、
 *    0.65〜1.1m に立っている相手の前へは平気で投げ、そのままカットされていた。
 *    立っている相手の前へは投げない、という形にする。カットは「レーンの外から
 *    走り込んで間に合った者」だけが成立する（closingBest）。
 */
export function laneVetoed(
  defenders: Player[], from: Player, to: Player, style: PassStyle = "chest",
): boolean {
  const block = laneBlock(defenders, from, to);
  return !!block && block.perp < LANE_W * VETO_FRAC && reachAt(from, block, style) > 0;
}
/** レーン幅のこの割合までに相手が立っていたら投げない。1.0 = レーン全部。 */
const VETO_FRAC = 1.0;

/**
 * レーンの**外**に居る相手が、ボールが自分の前を横切るまでに走り込んでカットできるか。
 * これが本来のパスカット。走って詰める距離と、手を伸ばす分で届くかを見る。
 *   ・速いパスほど滞空が短く、詰める時間が無い（P速度）
 *   ・パサーの P精度 が高いほど、動いてくる相手の先まで読んで通す
 */
export function closingBest(
  defenders: Player[], from: Player, to: Player, flightT: number, style: PassStyle,
): { def: Player; at: number; p: number } | null {
  let best: { def: Player; at: number; p: number } | null = null;
  for (const d of defenders) {
    const { t, perp } = segPerp(from.pos.x, from.pos.z, to.pos.x, to.pos.z, d.pos.x, d.pos.z);
    if (t <= 0.10 || t >= 0.90) continue;                 // パサー/受け手の真横
    if (perp <= LANE_W * VETO_FRAC) continue;             // 既にレーンの中 → そこへは投げない
    if (perp > CLOSE_MAX) continue;                       // 遠すぎて話にならない
    const y = passHeightAt(style, t, passReleaseY(style), 1.0);
    const tt = flightT * t;                               // その点をボールが通るまでの時間
    const cover = d.runSpeed * CLOSE_SPEED * tt
      + 0.35 + rate(d.attr.agility) * 0.25                // 最後の一歩＋手を伸ばす分
      + (d.has("interceptor") ? 0.35 : 0);
    const margin = cover - perp;
    if (margin < 0) continue;                             // 間に合わない
    // 走って詰めきったあとに残る時間。高い球はここが踏み切りの余裕になる。
    const spare = tt - perp / Math.max(0.5, d.runSpeed * CLOSE_SPEED);
    const reach = closeReach(d, y, spare);
    if (reach <= 0) continue;                             // 届かない高さを通る
    const hawk = rate(d.attr.reaction) * 0.5 + rate(d.attr.defense) * 0.3
      + rate(d.attr.agility) * 0.2;
    let p = clamp(margin / CLOSE_SPAN, 0, 1) * (0.30 + hawk * 0.55) * reach;
    p *= 1.15 - rate(from.attr.passSpd) * 0.5;            // 速い球ほど切りにくい
    p -= rate(from.attr.passAcc) * 0.22;                  // 精度が高いほど動きを読んで通す
    p = clamp(p, 0, 0.85);
    if (!best || p > best.p) best = { def: d, at: t, p };
  }
  return best;
}
/**
 * 走り込んだ守備者が、その高さの球へ手を出せるか(0..1)。
 * 高さの帯で必要なものが変わる。チェストのような胸〜頭の高さは走りながらでも手が
 * 出るが、高い球は伸び上がるか踏み切るかが要る。
 *   胸〜頭(身長×1.05)まで … reachFactor そのまま
 *   立ちリーチ(身長×1.33)まで … 伸び上がるので当たりが薄い（HIGH_RUN）
 *   それより上 … **踏み切る余裕(spare)が PLANT_T 以上ある時だけ**跳んで届く
 *   低い球(0.75m未満) … 走りながら手を下ろすのが難しい（LOW_CLOSE）
 * spare = ボールがその点を通るまでの時間 − 走って詰めるのに要る時間。
 */
function closeReach(d: Player, y: number, spare: number): number {
  const easy = d.height * 1.05;
  if (y <= easy) {
    let r = reachFactor(d, y);
    if (y < LOW_PASS) r *= LOW_CLOSE + (1 - LOW_CLOSE) * clamp(y / LOW_PASS, 0, 1);
    return r;
  }
  const stand = d.height * 1.33;
  if (y <= stand) return reachFactor(d, y) * HIGH_RUN;
  if (spare < PLANT_T) return 0;                       // 走り切るだけで精一杯 → 踏み切れない
  const top = stand + leapHeight(d);
  if (y > top) return 0;
  return clamp(1 - (y - stand) / Math.max(0.05, top - stand), 0, 1) * HIGH_JUMP;
}
/** 伸び上がって触る帯の当たりにくさ。 */
const HIGH_RUN = 0.45;
/** 踏み切って触る帯の当たりにくさ。 */
const HIGH_JUMP = 0.55;
/** 踏み切るのに要る余裕(秒)。走り込みでこれだけ残っていないと跳べない。 */
const PLANT_T = 0.22;
/** 走り込みでカットを狙える、レーンからの最大距離(m)。 */
const CLOSE_MAX = 4.5;
/** 詰めに使える走速度の割合（横方向へのダッシュなので全速では走れない）。 */
const CLOSE_SPEED = 0.85;
/** どれだけ余裕を持って届けば確実になるか(m)。 */
const CLOSE_SPAN = 1.0;
/** これより低い球は、走り込みながらだと手を下ろしにくい(m)。 */
const LOW_PASS = 0.75;
/** 床すれすれの球へ走り込んだときの、届きやすさの残り。 */
const LOW_CLOSE = 0.25;

// パサー自身の「このパスは通るか」の見積り。最も通る投げ方で評価する(バウンズで
// 手の下をくぐらせられるなら、そのリスクで判断する)。全パス判断がここを通る。
export function passRisk(defenders: Player[], from: Player, to: Player): number {
  return bestPassStyle(defenders, from, to).risk;
}

// リリース時に一度だけ、選んだパスが実際にカットされたか判定する。
/** どの経路でカットされたかの記録（計測用）。 */
export const CUT_SOURCE = { last: "" };

export function evalInterception(
  defenders: Player[], from: Player, to: Player, passStyle: PassStyle,
): { def: Player; at: number; reach: number } | null {
  const d0 = dist2D(from.pos, to.pos);
  const fade = d0 > 12 ? clamp(1 - (d0 - 12) * 0.05, 0.85, 1) : 1;
  const flightT = d0 / Math.max(1, passZip(from) * fade);
  // ⚠️ 本命は「レーンの外から走り込んでくる相手」。レーンに立っている相手へは
  //    そもそも投げない(laneVetoed)ので、そこを主役にしない。
  const run = closingBest(defenders, from, to, flightT, passStyle);
  if (run) {
    let p = run.p;
    if (from.has("throughPass") && to.cutting) p *= 0.75;
    if (chance(p)) { CUT_SOURCE.last = "走り込み"; return { def: run.def, at: run.at, reach: 1 }; }
  }
  // 拒否をすり抜けてレーンに残っている相手（強制フィード等）はこれまでどおり
  const block = laneBlock(defenders, from, to);
  if (!block) return null;
  const reach = reachAt(from, block, passStyle);
  if (reach <= 0) return null;   // 手の届く高さを外して通った
  let p = interceptChance(from, to, block, passStyle);
  if (from.has("throughPass") && to.cutting) p *= 0.75;
  if (chance(p)) { CUT_SOURCE.last = "レーンに居た"; return { def: block.def, at: block.t, reach }; }
  return null;
}
