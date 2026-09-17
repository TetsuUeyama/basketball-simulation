// 純粋な「評価プリミティブ」群 — コンテストの質、シュート射程、反応時間、溜め時間
// などを算出する。ゲーム状態を持たず入力は全て引数で受け取る純粋関数。
import { Player } from "./objects/player/player";
import { RIM, THREE_DIST, BURST_SPEED } from "./config";
import type { PassStyle } from "./config";
import { rate, clamp, rand } from "./util";

// L速度(3P射程)の基準点: 75 → 3Pライン、95 → センターライン（これが上限）。
const SHOOT_ARC = THREE_DIST;   // 6.75m（3Pライン）
const SHOOT_HALF = RIM.z;       // 13.0m（リング→センターライン）

// この守備者がこのシューターに対してどれだけリムを守れるか — 位置と体格のみで算出
// （高さ、ヘッド=リム保護、ジャンプ、守備）。平均的なコンテストが ≈0 になるよう中心化。
export function rimProtect(d: Player, shooter: Player): number {
  return clamp(
    (d.height - shooter.height) * 0.5
    + rate(d.attr.dunk) * 0.35            // ヘッド = リム保護 / ショットブロック
    + rate(d.attr.jump) * 0.25
    + rate(d.attr.defense) * 0.35
    - 0.505,                              // 平均的なコンテストが0付近になる基準
    -0.4, 0.6);
}

// この守備者がジャンパーをどれだけコンテストできるか — クローズアウトの速さ(反応/敏捷)、
// 守備、高さ。平均的なコンテストが ≈0 になるよう中心化。
export function perimContest(d: Player, shooter: Player): number {
  return clamp(
    rate(d.attr.reaction) * 0.35 + rate(d.attr.agility) * 0.3 + rate(d.attr.defense) * 0.5
    + (d.height - shooter.height) * 0.15
    - 0.64,
    -0.35, 0.4);
}

// 手のひらの「当たり判定」半径(m): 基準 + (守備者の守備 − 攻撃者のオフェンス)。
// 守備者が上なら大きく、攻撃者が上回れば小さくなる。
/**
 * コンテストが届く距離(m)。
 * ⚠️ **既知の問題（未解決）**: 基準が 1.5m なので、**守備が 1.8m 離れていると
 *    フリーと完全に同じ成功率**になる（実測: 3Pの成功率が 守備3m と 1.8m で同値）。
 *    基準を 2.0 に上げる修正を試したが、**全シュートに効いて FG が 46.7% → 42.3% まで
 *    落ちた**（実際のバスケットは約47%）ので戻した。
 *    直すなら3P限定で効かせる形にすること。一律に伸ばすと全体が崩れる。
 */
export function palmRadius(def: Player, att: Player): number {
  return clamp(1.5 + 1.7 * (rate(def.attr.defense) - rate(att.attr.offense)), 0.5, 2.6);
}

// 連携: チーム戦術をどれだけ忠実に遂行するか — 判断内の戦術由来の項に掛ける係数。
export function twWeight(p: Player): number {
  return 0.35 + rate(p.attr.teamwork) * 0.65;
}

// この守備者が攻撃アクションに「反応」するまでの時間(秒) — 守備(ディフェンス)と
// 守備+反応の平均(ability)でラグが決まる。最速(ability=1)≈0.2秒、最遅(ability=0)≈1.2秒、
// 平均能力(ability≈0.735)で≈0.6秒。指数0.69で中央を膨らませ平均を0.6へ寄せる。小さな揺らぎ付き。
export function reactionLag(p: Player): number {
  const ability = (rate(p.attr.defense) + rate(p.attr.reaction)) / 2;   // 1 = 両方エリート
  return clamp((0.2 + Math.pow(1 - ability, 0.69)) * rand(0.9, 1.1), 0.2, 1.2);
}

// L速度(3P射程) → この選手が無理なく打てる距離。75=3Pライン、95=センターライン(上限)。
// 75未満は快適射程がライン内側に入る(それより外も打てるが溜め時間が要る — gatherFor 参照)。
export function shootRangeOf(p: Player): number {
  const r = SHOOT_ARC + (p.attr.threeRange - 75)
    * (SHOOT_HALF - SHOOT_ARC) / 20;   // 75→ライン, 95→ハーフ, 線形
  return clamp(r, 4.5, SHOOT_HALF) + (p.has("range") ? 1.0 : 0);
}

// P速度 → パスの球速(m/s)。実在帯の両端を基準に取り、65(DB最低)で12.0、95(DB最高)で
// 20.15。72(中央値)は13.6、10で6.1(山なり)。指数カーブなのは、選手データが65..85に
// 密集していて線形では差が出ないため。全パス経路がこの1関数を通る。
export function passZip(p: Player): number {
  return 6 + 15.89 * Math.pow(rate(p.attr.passSpd), 2.26);
}

// パスのリリース高さ(m)。オーバーヘッドは頭上、ジャンプパスは守備の頭上。
export function passReleaseY(style: PassStyle): number {
  return style === "overhead" ? 2.15 : style === "jump" ? 2.0 : 1.1;
}

// パス軌道の高さ(m)。k=0(リリース)..1(キャッチ)。判定と描画が同じ式を使うための単一ソース。
export function passHeightAt(style: PassStyle, k: number, fromY: number, endY: number): number {
  if (style === "bounce") {
    // ⚠️ バウンド地点。0.58 だとバウンド前 58% / 後 42% でほぼ同じ距離に見えていた。
    //    実際のバウンズパスは床に着いてから受け手までが短い。0.75 でバウンド後は
    //    全体の 25% = 従来(42%)の約 6割。
    const kb = 0.75;   // 手元→床(75%)→受け手の手元 のV字
    return k < kb
      ? fromY + (0.12 - fromY) * (k / kb)
      : 0.12 + (clamp(endY, 0.7, 0.95) - 0.12) * ((k - kb) / (1 - kb));
  }
  const arc = style === "chest" ? 0.4 : 0.25;   // 高いリリースは山を低くして高さを保つ
  return fromY + (endY - fromY) * k + Math.sin(k * Math.PI) * arc;
}

// この守備者がその高さのボールに手を出せるか(0=届かない .. 1=真芯)。
// 床すれすれ(0.25m未満)と立位リーチ超は触れない。腰から頭までが楽な帯で、
// その下(かがんで下ろす=バウンズ)と上(伸び上がる=オーバーヘッド)は届きにくい。
export function reachFactor(d: Player, y: number): number {
  const lo = 0.25, easyLo = 0.8, easyHi = d.height * 1.05, maxHi = d.height * 1.33;
  if (y < lo || y > maxHi) return 0;
  if (y < easyLo) return clamp(0.15 + ((y - lo) / (easyLo - lo)) * 0.45, 0.15, 0.6);
  if (y <= easyHi) return 1;
  return clamp(1 - (y - easyHi) / (maxHi - easyHi), 0.15, 1);
}

// 快適射程を超えた距離から打つのに必要な溜め(秒): shootRangeOf を超えるほど長くなる。
export function gatherFor(p: Player, dHoop: number): number {
  const over = dHoop - shootRangeOf(p);
  return over <= 0 ? 0 : over * 0.22;   // 射程超過1mあたり約0.22秒
}

// ディープ3の資格: L精度とL速度がともに90以上のエリートか。
export function deepThreeOK(p: Player): boolean {
  return p.attr.threeAcc >= 90 && p.attr.threeRange >= 90;
}

// エリート(90/90)はラインの遥か外まで射程。それ以外は全員ライン際(THREE_DIST+0.5)までは
// オープンなら打つ（深いヒーブはエリート限定）。
/**
 * この選手がオープンなら打つ最大距離(m)。
 * ⚠️ 旧実装は `deepThreeOK`(3P精度90 かつ L速度90) の選手だけ `shootRangeOf` を使い、
 *    それ以外は全員 `THREE_DIST + 0.5` の**固定値**だった。DB 4015人のうち 90/90 を
 *    満たすのは **2人(0.05%)** なので、実質**全員が同じ 7.25m**。L速度の差が射程に
 *    まったく出ていなかった。さらに持ち場も 7.25m なので、**全員が射程の境界線上**に
 *    立ち、少し外へ押し出されるだけで「射程外 → ドライブへ切替」に落ちていた。
 * ⚠️ L速度は溜め時間(`threePrepFor`)と精度の距離減衰(`shot-outcome`)にも効く。
 *    射程まで急勾配にすると三重に効いてしまうので、ここは**緩やかな曲線**にする。
 *      70→7.0 / 75→7.4 / 80→8.0 / 85→8.7 / 90→9.5 / 95→10.5
 *    下限は 3Pライン+0.4m。誰でもライン際からは打てる。
 */
export function effShootRange(p: Player): number {
  const seg: [number, number][] = [
    [70, 7.0], [75, 7.4], [80, 8.0], [85, 8.7], [90, 9.5], [95, 10.5], [100, 11.5],
  ];
  const v = p.attr.threeRange;
  let r = seg[0][1];
  if (v > seg[0][0]) {
    r = seg[seg.length - 1][1];
    for (let i = 1; i < seg.length; i++) {
      const [x1, y1] = seg[i], [x0, y0] = seg[i - 1];
      if (v <= x1) { r = y0 + (y1 - y0) * ((v - x0) / (x1 - x0)); break; }
    }
  }
  if (p.has("range")) r += 1.0;
  return Math.max(THREE_DIST + 0.4, r);
}


// 3Pの準備時間(秒)。L速度95で即発射(0)、下がるほど少しずつ延長。
// さらにディープ3は3Pラインからの超過距離が伸びるほど(二次で)延長する。
/** 3Pの溜め時間の倍率。1.0 だと守備が寄り切ってしまい、理論値の半分しか決まらなかった。 */
const THREE_PREP_SCALE = 0.5;
export function threePrepFor(h: Player, dHoop: number): number {
  // 素の準備時間(ライン上): L速度10で2.5秒 → 95で0.36秒 を線形に(能力差を均等に)。
  const base = clamp(2.5 + (h.attr.threeRange - 10) * (0.36 - 2.5) / 85, 0.36, 2.5);
  const over = Math.max(0, dHoop - THREE_DIST);            // 3Pラインからの超過距離
  const deep = over * 0.14 + over * over * 0.02;           // 深いほど二次で延長
  // ⚠️ 溜めを半分にした。実測で3Pの成功率が 27.1% → 33.2% に上がり、実際の値(約36%)へ
  //    近づいた。以前は溜めの間に守備が寄り切ってしまい、理論値の半分しか決まっていなかった。
  let w = (base + deep) * THREE_PREP_SCALE;
  if (h.has("range")) w *= 0.7;                            // レンジ特能は準備が速い
  return w;
}

// この選手がこのシュートで要する溜め時間(リリース前のオーバーヘッドの構え)。
// 3PはL速度+距離ベース(threePrepFor)、ミドルは従来のS技術ベース。
/** お膳立ての質が最大の時、シュートの溜めをどれだけ縮めるか。 */
const SETUP_RELEASE = 0.45;
export function shotWindupFor(h: Player, dHoop: number): number {
  let w = dHoop > THREE_DIST
    ? threePrepFor(h, dHoop)
    : 0.16 + gatherFor(h, dHoop) + (1 - rate(h.attr.shotTech)) * 0.12;
  if (h.quickT > 0 && h.has("oneTouch")) w *= 0.55;   // ダイレクト: クイックリリース
  // お膳立て: 良いパスをリズムよく受けた窓の間はリリースが速い（成功率は足さない）
  if (h.setupT > 0) w *= 1 - h.setupQuick * SETUP_RELEASE;
  return w;
}

// 打つべきでないシュート: 長い溜めをしている最中に守備者が射程内にいると、上がる前に
// 剥がされ/ブロックされる可能性が高い。
export function wontLoadUp(h: Player, dHoop: number, dDef: number): boolean {
  return shotWindupFor(h, dHoop) > 0.45 && dDef < 1.7 && h.beatenT <= 0;
}

// ドリブルの揺さぶり量: 敏捷性/D精度/技術＋ドリブラー特能（攻め側の deception）。
export function jukeDeception(h: Player): number {
  return rate(h.attr.agility) * 0.45 + rate(h.attr.dribbleAcc) * 0.4
    + rate(h.attr.handling) * 0.15 + (h.has("driver") ? 0.1 : 0);
}

// 守備が前に留まり食いつかない度合い: 守備＋バースト（守り側の discipline）。
export function jukeDiscipline(d: Player): number {
  return rate(d.attr.defense) * 0.4 + rate(d.attr.agility) * 0.35
    + rate(d.attr.reaction) * 0.25 + (d.has("manMark") ? 0.1 : 0);
}

// シュート脅威: 3Pとミドルのうち高いほうのS精度係数(0..1)。
export function shotThreat(p: Player): number {
  return Math.max(rate(p.attr.threeAcc), rate(p.attr.midAcc));
}

// バースト持続時間(秒): 距離を BURST_SPEED で詰める想定に揺らぎと優位度延長を掛ける。
export function burstTime(dist: number, edge: number): number {
  return clamp(dist / BURST_SPEED, 0.5, 1.3) * rand(0.95, 1.15)
    * (1 + Math.max(0, edge) * 0.2);
}

// 守備の手: 反応/敏捷/守備＋インターセプター特能。スティール・ポーク確率の共通ベース。
export function defHands(d: Player): number {
  return rate(d.attr.reaction) * 0.45 + rate(d.attr.agility) * 0.35 + rate(d.attr.defense) * 0.2
    + (d.has("interceptor") ? 0.15 : 0);
}

// ボール保持力: D精度/技術＋ドリブルキープ特能。剥がされ耐性の共通ベース。
export function ballSecurity(h: Player): number {
  // D精度を主、技術を従として合成した「生の」ドリブル技量(0..100)。
  const v = h.attr.dribbleAcc * 0.75 + h.attr.handling * 0.25;
  return keepCurve(v) + (h.has("keepDribble") ? 0.20 : 0);
}

/**
 * ドリブル技量(0..100) → ボール保持力(0..1)。
 * ⚠️ 線形の rate() では、DBの能力値が 65〜85 に固まっているせいで差がほとんど出ない。
 *    実プレーの感覚に合わせて**節点を置いた曲線**にする。
 *      〜70   下手（明確に失う）
 *      70〜75 並み
 *      75〜   上手い。80 / 85 / 90 / 95 で段階的に安全になる
 *    75〜90 を最も急にしてあるのは、選手の大半がこの帯に居て差が出てほしいため。
 */
function keepCurve(v: number): number {
  const seg: [number, number][] = [
    [60, 0.28], [70, 0.45], [75, 0.55], [80, 0.67],
    [85, 0.78], [90, 0.88], [95, 0.95], [100, 1.00],
  ];
  if (v <= seg[0][0]) return seg[0][1];
  for (let i = 1; i < seg.length; i++) {
    const [x1, y1] = seg[i], [x0, y0] = seg[i - 1];
    if (v <= x1) return y0 + (y1 - y0) * ((v - x0) / (x1 - x0));
  }
  return 1.0;
}

// コンテスト踏切の跳躍高さ(m)。
export function leapHeight(d: Player): number {
  return 0.55 + rate(d.attr.jump) * 0.3;
}

// 剥がしの優位度 = 守備の手 − ハンドラーの保持力。正なら守備有利。
/**
 * ⚠️ 選手DBの能力値は概ね 65〜85 に固まっており、素の差では stripEdge がほぼ 0 付近に
 *    張り付いて**誰が持っても剥がされ方が同じ**になる（実測: D精度 65〜75 / 75〜85 /
 *    85〜101 で 1000フレームあたり 1.17 / 0.81 / 0.65 と差が小さい）。
 *    差を STRIP_GAIN 倍に広げ、能力差が結果に出るようにする。守備側にも同じだけ効く。
 */
const STRIP_GAIN = 1.6;   // 曲線側で差が付くので倍率は控えめに
/**
 * 守って持っている時、奪われる確率に掛ける倍率（1 = 守っていない）。
 * ⚠️ これまで keepShieldT は**速度を落とすだけ**で、ボールの安全性には一切
 *    効いていなかった。「抜けないが奪われない」という選択肢が成立しておらず、
 *    キープしている選手がそのまま突かれて失っていた。
 * ⚠️ 守りの巧さはハンドリングで決まる。下手な選手が構えても半分程度しか守れない。
 */
export const SHIELD = { keep: 0.30, protect: 0.55, skill: 0.5 };
export function shieldMul(h: Player): number {
  const base = h.keepShieldT > 0 ? SHIELD.keep : h.protectT > 0 ? SHIELD.protect : 1;
  if (base >= 1) return 1;
  // 上手い選手ほど設計値どおりに守れる。下手な選手は守り切れない（1 側へ戻る）。
  const skill = SHIELD.skill + rate(h.attr.handling) * (1 - SHIELD.skill);
  return 1 - (1 - base) * skill;
}

export function stripEdge(d: Player, h: Player): number {
  return (defHands(d) - ballSecurity(h)) * STRIP_GAIN;
}
