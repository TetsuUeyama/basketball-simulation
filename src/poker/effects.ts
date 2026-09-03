// カード → 能力強化の対応表。バランス調整のノブはこのファイルに集約する。
//
// 設計:
//  - スートが「能力の系統」を決める（♥=オフェンス / ♦=ディフェンス / ♠=シュート / ♣=フィジカル）。
//  - ランクが「量と対象」を決める（A=系統の主能力へ大きく / 絵札=系統内の特定能力へ / 数札=主能力へ小さく）。
//  - 同じカードでも**選手によって効きが変わる**。その能力が高い選手ほど大きく伸びる（長所を伸ばす）。
//  - 捨て札は選手個人へ、役はチーム全13人へ乗る。あくまで補助であり、戦力差を覆さない量に留める。
import { ATTR_META, type Attributes } from "../attributes";
import { clamp, rate } from "../util";
import type { Card, Suit } from "./cards";
import type { HandRank } from "./hands";

export type AttrKey = keyof Attributes;

export interface SuitGroup {
  label: string;
  /** 数札とAが伸ばす主能力。 */
  primary: AttrKey;
  /** 絵札が伸ばす能力（J/Q/K）。 */
  face: { 11: AttrKey; 12: AttrKey; 13: AttrKey };
  /** 役によるチーム強化が乗る能力の集合。 */
  attrs: AttrKey[];
}

export const SUIT_GROUP: Record<Suit, SuitGroup> = {
  H: {
    label: "オフェンス",
    primary: "offense",
    face: { 11: "passAcc", 12: "passSpd", 13: "handling" },
    attrs: ["offense", "passAcc", "passSpd", "handling", "aggression"],
  },
  D: {
    label: "ディフェンス",
    primary: "defense",
    face: { 11: "reaction", 12: "agility", 13: "dunk" },
    attrs: ["defense", "reaction", "agility", "dunk"],
  },
  S: {
    label: "シュート",
    primary: "midAcc",
    face: { 11: "threeAcc", 12: "threeRange", 13: "shotTech" },
    attrs: ["midAcc", "threeAcc", "threeRange", "shotTech", "freeThrow"],
  },
  C: {
    label: "フィジカル",
    primary: "balance",
    face: { 11: "speed", 12: "accel", 13: "jump" },
    attrs: ["balance", "stamina", "speed", "accel", "jump"],
  },
};

// ---- 調整ノブ -------------------------------------------------------------
/** 1回の交換で捨てられる最大枚数（＝1回に得られる個人強化の上限）。5 = 手札を全部捨てられる。 */
export const MAX_DISCARDS = 5;
/** 捨て札1枚の基礎量: A / 絵札 / 数札。 */
export const DISCARD_BASE = { ace: 5, face: 3, number: 2 };
/** 選手適性の倍率レンジ。能力0で LOW 倍、能力100で HIGH 倍。 */
export const FIT_MULT = { low: 0.6, high: 1.4 };
/**
 * 役ごとのチーム強化。group=系統の各能力へ / all=全能力へ。tier(0..9)で引く。
 *
 * ⚠️ `all` は25能力×13人に乗るので `group`(4〜5能力)の5倍効く。初版は上位役に `all` を
 * 積んでいたが、実測でロイヤル固定の勝率が 75%（基準40%）まで跳ねたため、`all` を外して
 * 系統への集中に振り直した。数字の根拠は work-record.md の実測表を参照。
 */
export const HAND_BUFF: { group: number; all: number }[] = [
  { group: 0, all: 0 },    // 0 ハイカード — 役なし
  { group: 2, all: 0 },    // 1 ワンペア
  { group: 3, all: 0 },    // 2 ツーペア
  { group: 4, all: 0 },    // 3 スリーカード
  { group: 5, all: 0 },    // 4 ストレート
  { group: 6, all: 0 },    // 5 フラッシュ
  { group: 7, all: 0 },    // 6 フルハウス
  { group: 9, all: 0 },    // 7 フォーカード
  { group: 11, all: 0 },   // 8 ストレートフラッシュ
  { group: 12, all: 0 },   // 9 ロイヤルストレートフラッシュ
];
// ---------------------------------------------------------------------------

/** 能力値の上限。ここを超える強化は切り捨てる。 */
export const ATTR_CAP = 100;

/** Attributes の全キー（ATTR_META が唯一の正）。 */
export const ALL_ATTR_KEYS: AttrKey[] = ATTR_META.map((m) => m.key);

export interface AttrEffect {
  key: AttrKey;
  amount: number;
}

/** そのカードがどの能力を伸ばすか（選手に依らない部分）。 */
export function effectKey(card: Card): AttrKey {
  const g = SUIT_GROUP[card.suit];
  if (card.rank >= 11) return g.face[card.rank as 11 | 12 | 13];
  return g.primary;
}

/** そのカードの基礎量（選手に依らない部分）。 */
export function effectBase(card: Card): number {
  if (card.rank === 1) return DISCARD_BASE.ace;
  if (card.rank >= 11) return DISCARD_BASE.face;
  return DISCARD_BASE.number;
}

/**
 * 捨て札1枚がこの選手にもたらす強化。
 * 同じカードでも、その能力が高い選手ほど大きく伸びる（`FIT_MULT`）。
 * 能力が上限に達している場合は amount=0 を返す（無駄打ちが分かるように）。
 */
export function discardEffect(card: Card, attr: Attributes): AttrEffect {
  const key = effectKey(card);
  const mult = FIT_MULT.low + (FIT_MULT.high - FIT_MULT.low) * rate(attr[key]);
  const raw = Math.max(1, Math.round(effectBase(card) * mult));
  const room = Math.max(0, ATTR_CAP - attr[key]);
  return { key, amount: Math.min(raw, room) };
}

/** 役が確定したときにチーム全員へ乗る強化（1人ぶん）。 */
export function handEffects(rank: HandRank): AttrEffect[] {
  const buff = HAND_BUFF[rank.tier] ?? HAND_BUFF[0];
  const out: AttrEffect[] = [];
  const group = SUIT_GROUP[rank.suit];
  const perKey = new Map<AttrKey, number>();
  if (buff.group > 0) for (const k of group.attrs) perKey.set(k, buff.group);
  if (buff.all > 0) {
    for (const k of ALL_ATTR_KEYS) perKey.set(k, (perKey.get(k) ?? 0) + buff.all);
  }
  for (const [key, amount] of perKey) out.push({ key, amount });
  return out;
}

/** 役の効果を1行で説明する（UI とログ用）。 */
export function handSummary(rank: HandRank): string {
  const buff = HAND_BUFF[rank.tier] ?? HAND_BUFF[0];
  if (!buff.group && !buff.all) return "強化なし";
  const parts: string[] = [];
  if (buff.group) parts.push(`${SUIT_GROUP[rank.suit].label}系 +${buff.group}`);
  if (buff.all) parts.push(`全能力 +${buff.all}`);
  return parts.join(" / ");
}

/** 強化を1つ能力値へ足す。上限で切り、実際に乗った量を返す（巻き戻し用）。 */
export function addAttr(attr: Attributes, key: AttrKey, amount: number): number {
  const before = attr[key];
  const after = clamp(before + amount, 0, ATTR_CAP);
  attr[key] = after;
  return after - before;
}
