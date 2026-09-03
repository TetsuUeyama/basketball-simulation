// 5枚の手札から役を判定する。純粋関数のみ（ヘッドレスでそのまま検証できる）。
import type { Card, Suit } from "./cards";

export type HandKind =
  | "high" | "pair" | "twoPair" | "trips" | "straight"
  | "flush" | "fullHouse" | "quads" | "straightFlush" | "royalFlush";

export interface HandRank {
  kind: HandKind;
  /** 0(ハイカード) .. 9(ロイヤルストレートフラッシュ)。強化量はこれで引く。 */
  tier: number;
  name: string;
  /** 役を構成する札の主スート。チーム強化がどの系統に乗るかを決める。 */
  suit: Suit;
  /** 同じ役同士を比べるための補助値（役を作る札のランク、降順）。 */
  keys: number[];
}

const NAMES: Record<HandKind, string> = {
  high: "ハイカード",
  pair: "ワンペア",
  twoPair: "ツーペア",
  trips: "スリーカード",
  straight: "ストレート",
  flush: "フラッシュ",
  fullHouse: "フルハウス",
  quads: "フォーカード",
  straightFlush: "ストレートフラッシュ",
  royalFlush: "ロイヤルストレートフラッシュ",
};

const TIER: Record<HandKind, number> = {
  high: 0, pair: 1, twoPair: 2, trips: 3, straight: 4,
  flush: 5, fullHouse: 6, quads: 7, straightFlush: 8, royalFlush: 9,
};

/** A を 14 として扱った値（ストレート判定と強さ比較用。A-2-3-4-5 は別途扱う）。 */
const high = (rank: number): number => (rank === 1 ? 14 : rank);

/** 指定ランクの札のうち最も多いスート。同数なら SUITS の順で先のもの。 */
function dominantSuit(cards: Card[]): Suit {
  const count: Record<string, number> = {};
  let best: Suit = cards[0].suit;
  let bestN = 0;
  for (const c of cards) {
    const n = (count[c.suit] = (count[c.suit] ?? 0) + 1);
    if (n > bestN) { bestN = n; best = c.suit; }
  }
  return best;
}

/** 5枚（不足していれば手札の枚数ぶん）から役を判定する。 */
export function evalHand(hand: Card[]): HandRank {
  const cards = hand.slice();
  const by: Record<number, Card[]> = {};
  for (const c of cards) (by[c.rank] ??= []).push(c);
  // 同ランクの枚数で降順、同数ならランクの強い方を先に
  const groups = Object.values(by).sort((a, b) => b.length - a.length || high(b[0].rank) - high(a[0].rank));

  const flush = cards.length === 5 && cards.every((c) => c.suit === cards[0].suit);

  // ストレート判定: 重複なし5枚が連番。A は 14 としても 1 としても使える。
  const vals = [...new Set(cards.map((c) => high(c.rank)))].sort((a, b) => a - b);
  let straight = false;
  let straightTop = 0;
  if (cards.length === 5 && vals.length === 5) {
    if (vals[4] - vals[0] === 4) { straight = true; straightTop = vals[4]; }
    // ホイール（A-2-3-4-5）: A=14 が入った 2,3,4,5,14
    else if (vals[0] === 2 && vals[1] === 3 && vals[2] === 4 && vals[3] === 5 && vals[4] === 14) {
      straight = true; straightTop = 5;
    }
  }

  const make = (kind: HandKind, key: Card[], keys: number[]): HandRank =>
    ({ kind, tier: TIER[kind], name: NAMES[kind], suit: dominantSuit(key), keys });

  if (straight && flush) {
    const kind: HandKind = straightTop === 14 ? "royalFlush" : "straightFlush";
    return make(kind, cards, [straightTop]);
  }
  if (groups[0].length === 4) return make("quads", groups[0], [high(groups[0][0].rank)]);
  if (groups[0].length === 3 && groups[1]?.length === 2) {
    return make("fullHouse", [...groups[0], ...groups[1]], [high(groups[0][0].rank), high(groups[1][0].rank)]);
  }
  if (flush) return make("flush", cards, vals.slice().reverse());
  if (straight) return make("straight", cards, [straightTop]);
  if (groups[0].length === 3) return make("trips", groups[0], [high(groups[0][0].rank)]);
  if (groups[0].length === 2 && groups[1]?.length === 2) {
    return make("twoPair", [...groups[0], ...groups[1]], [high(groups[0][0].rank), high(groups[1][0].rank)]);
  }
  if (groups[0].length === 2) return make("pair", groups[0], [high(groups[0][0].rank)]);
  return make("high", cards, vals.slice().reverse());
}

/** a が b より強ければ正、弱ければ負、同じなら 0。 */
export function compareHands(a: HandRank, b: HandRank): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const n = Math.max(a.keys.length, b.keys.length);
  for (let i = 0; i < n; i++) {
    const d = (a.keys[i] ?? 0) - (b.keys[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
