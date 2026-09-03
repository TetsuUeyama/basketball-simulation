// トランプの札とデッキ。ポーカー強化システムの土台。
// 乱数は再現性のため必ず rng.ts のシード付き乱数を通す（Math.random は使わない）。
import type { Rng } from "../rng";

export type Suit = "H" | "D" | "S" | "C";

/** rank: 1..13（1=A, 11=J, 12=Q, 13=K）。 */
export interface Card {
  suit: Suit;
  rank: number;
}

export const SUITS: Suit[] = ["H", "D", "S", "C"];

export const SUIT_MARK: Record<Suit, string> = { H: "♥", D: "♦", S: "♠", C: "♣" };

/** 赤スート（♥♦）は表示色を変える。 */
export const SUIT_RED: Record<Suit, boolean> = { H: true, D: true, S: false, C: false };

const RANK_LABEL = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const rankLabel = (rank: number): string => RANK_LABEL[rank] ?? String(rank);

export const cardLabel = (c: Card): string => `${SUIT_MARK[c.suit]}${rankLabel(c.rank)}`;

/** 絵札(J/Q/K)か。 */
export const isFace = (c: Card): boolean => c.rank >= 11;

/** 52枚の新しいデッキ（並びは固定。切るのは shuffle）。 */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank });
  }
  return deck;
}

/** Fisher-Yates。deck をその場で切る。 */
export function shuffle(deck: Card[], rng: Rng): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
}

/** 切ったばかりのデッキを1つ作る。 */
export function freshDeck(rng: Rng): Card[] {
  const deck = makeDeck();
  shuffle(deck, rng);
  return deck;
}

/** デッキの上から n 枚引く（デッキから取り除く）。足りなければあるだけ返す。 */
export function draw(deck: Card[], n: number): Card[] {
  return deck.splice(0, Math.min(n, deck.length));
}
