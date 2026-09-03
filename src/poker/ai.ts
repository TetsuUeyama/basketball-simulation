// CPU のポーカー判断。ユーザーが操作しないチームは全てここを通る（CPU対CPUも同じ）。
import type { PlayerDef } from "../attributes";
import { STARTERS } from "../roster";
import type { Card } from "./cards";
import { evalHand } from "./hands";
import { discardEffect, hinderEffect, MAX_DISCARDS } from "./effects";
import type { DiscardTarget, PokerMatch } from "./state";

/** 手札から「残す札」の添字を選ぶ。標準的なドローポーカーの定石。 */
export function keepIndexes(hand: Card[]): number[] {
  const idx = hand.map((_, i) => i);
  const made = evalHand(hand);
  // ストレート以上は完成しているので触らない
  if (made.tier >= 4) return idx;

  const byRank = new Map<number, number[]>();
  const bySuit = new Map<string, number[]>();
  hand.forEach((c, i) => {
    (byRank.get(c.rank) ?? byRank.set(c.rank, []).get(c.rank)!).push(i);
    (bySuit.get(c.suit) ?? bySuit.set(c.suit, []).get(c.suit)!).push(i);
  });

  // ペア以上があればそれを残す（ツーペアなら4枚、スリーカードなら3枚）
  const sets = [...byRank.values()].filter((v) => v.length >= 2);
  if (sets.length) return sets.flat();

  // 4枚フラッシュドロー
  for (const v of bySuit.values()) if (v.length === 4) return v;

  // 4枚ストレートドロー（A は 1 と 14 の両方で見る）
  const straightKeep = fourToStraight(hand);
  if (straightKeep) return straightKeep;

  // 手がかりなし: 一番高い札だけ残して他は捨てる（捨て札は選手強化になる）
  const highest = idx.reduce((a, b) => (val(hand[b]) > val(hand[a]) ? b : a), 0);
  return [highest];
}

/** 捨てる札の添字（keepIndexes の裏返し。1回の上限で切る）。 */
export function discardIndexes(hand: Card[]): number[] {
  const keep = new Set(keepIndexes(hand));
  const drop = hand.map((_, i) => i).filter((i) => !keep.has(i));
  // 上限を超える場合は価値の低い札から捨てる
  drop.sort((a, b) => val(hand[a]) - val(hand[b]));
  return drop.slice(0, MAX_DISCARDS).sort((a, b) => a - b);
}

/**
 * その捨て札を誰に置くか。「自軍の強化」と「相手の妨害」を同じ物差し（動く点数）で
 * 比べて大きい方を選ぶ。同点なら自軍を選ぶ。どちらも先発5人が対象。
 * 伸びしろではなく長所を伸ばす／相手の長所を削る側に賭ける（効果はその能力が
 * 高い選手ほど大きいため）。
 */
export function pickTarget(card: Card, roster: PlayerDef[][], team: number): DiscardTarget {
  let best: DiscardTarget = { team, idx: 0 };
  let bestVal = -Infinity;
  const own = roster[team] ?? [];
  for (let i = 0; i < Math.min(STARTERS, own.length); i++) {
    const gain = discardEffect(card, own[i].attr).amount;
    if (gain > bestVal) { bestVal = gain; best = { team, idx: i }; }
  }
  const oppTeam = 1 - team;
  const opp = roster[oppTeam] ?? [];
  for (let i = 0; i < Math.min(STARTERS, opp.length); i++) {
    const loss = -hinderEffect(card, opp[i].attr).amount;
    if (loss > bestVal) { bestVal = loss; best = { team: oppTeam, idx: i }; }
  }
  return best;
}

/**
 * CPU の1手を「決めるだけ」。適用しないので、UI が思考時間と札を置く動きを
 * 見せてから exchange を呼べる。
 */
export function cpuPlan(match: PokerMatch, team: number, roster: PlayerDef[][]):
    { picks: number[]; targets: DiscardTarget[] } {
  const hand = match.teams[team].hand;
  const picks = discardIndexes(hand);
  // 1人1枚。同じ相手/味方に重ならないよう、既に埋まった枠は次善へ回す
  const used = new Set<string>();
  const targets = picks.map((i) => {
    const t = pickTarget(hand[i], roster, team);
    let pick = t;
    for (let k = 0; k < STARTERS && used.has(`${pick.team}:${pick.idx}`); k++) {
      pick = { team: t.team, idx: (t.idx + k + 1) % STARTERS };
    }
    used.add(`${pick.team}:${pick.idx}`);
    return pick;
  });
  return { picks, targets };
}

/** CPU の1手を決めて即適用する（ヘッドレス計測など、見せる必要が無い場面用）。 */
export function cpuExchange(match: PokerMatch, team: number, roster: PlayerDef[][]): void {
  if (!match.canExchange(team)) return;
  const { picks, targets } = cpuPlan(match, team, roster);
  match.exchange(team, picks, targets);
}

/** ラウンド別の確定ライン（tier）。ここを下回るうちは持ち越す。 */
export const CPU_CONFIRM_TIER = [99, 5, 3, 2, 0];

/** CPU がホームのとき、いま確定するか。 */
export function cpuWantsConfirm(match: PokerMatch): boolean {
  const rank = match.peek(match.home);
  const line = CPU_CONFIRM_TIER[match.round] ?? 0;
  return rank.tier >= line;
}

/** A=14 として札の高さ。 */
const val = (c: Card): number => (c.rank === 1 ? 14 : c.rank);

/** 4枚で連番になっている組があればその添字を返す。 */
function fourToStraight(hand: Card[]): number[] | null {
  for (const aceHigh of [false, true]) {
    const v = hand.map((c) => (c.rank === 1 ? (aceHigh ? 14 : 1) : c.rank));
    const seen = new Map<number, number>();
    v.forEach((x, i) => { if (!seen.has(x)) seen.set(x, i); });
    const uniq = [...seen.keys()].sort((a, b) => a - b);
    for (let s = 0; s + 3 < uniq.length; s++) {
      const win = uniq.slice(s, s + 4);
      // 4枚が5連番の幅に収まる = あと1枚でストレート
      if (win[3] - win[0] <= 4) return win.map((x) => seen.get(x)!);
    }
  }
  return null;
}
