// ポーカー強化の進行。Babylon にも DOM にも依存しない（ヘッドレスでそのまま多試合まわせる）。
//
// 流れ:
//   ラウンド1(試合開始前) … 5枚ずつ配る → 各チーム1回だけ交換 → ホームが「確定 or 持ち越し」
//   ラウンド2..4(Q2/Q3/Q4開始前) … 各チーム1回だけ交換 → ホームが「確定 or 持ち越し」
//   確定した瞬間に**両チームの**手が公開され、役に応じたチーム強化が試合終了まで乗る。
//   ラウンド4まで確定しなければ、そこで自動確定する。
// 捨て札の個人強化は確定を待たず、捨てた瞬間に乗る。
import { ATTR_META, type PlayerDef } from "../attributes";
import { createRng, type Rng } from "../rng";
import { cardLabel, draw, freshDeck, type Card } from "./cards";
import { evalHand, type HandRank } from "./hands";
import { addAttr, discardEffect, handEffects, handSummary, hinderEffect, MAX_DISCARDS, type AttrKey } from "./effects";

/** ラウンド数 = クォーター数。Q1開始前 .. Q4開始前。 */
export const POKER_ROUNDS = 4;
export const HAND_SIZE = 5;

/** 捨て札の置き先。自軍なら強化、相手なら妨害になる。 */
export interface DiscardTarget {
  team: number;
  idx: number;    // ロスター番号
}

/** 実際に能力値へ乗った増減1件（試合後に巻き戻すために全て記録する）。 */
export interface AppliedDelta {
  team: number;         // 増減を受けた選手のチーム
  idx: number;          // ロスター番号
  key: AttrKey;
  amount: number;       // 上限/下限で切った後の実効量（妨害は負）
  source: "discard" | "hand";
  by: number;           // その手を打ったチーム（誰の仕業か）
  round: number;        // 何ラウンド目の手か（UI が「今ラウンドの動き」を出すのに使う）
  card?: Card;          // その増減を生んだ捨て札（source="discard" のとき）
}

export interface PokerTeamState {
  hand: Card[];
  /** そのラウンドで交換を使ったか。 */
  usedThisRound: boolean;
  exchanges: number;    // 交換した回数（累計）
  locked: boolean;
  rank: HandRank | null;
  /** 表示用のできごと（「♥7を捨てて 田中 のオフェンス+2」など）。 */
  log: string[];
}

export type PokerStage = "exchange" | "confirmChoice" | "done";

export class PokerMatch {
  rng: Rng;
  deck: Card[];
  teams: [PokerTeamState, PokerTeamState];
  /** 1..4。POKER_ROUNDS を超えたら done。 */
  round = 1;
  stage: PokerStage = "exchange";
  /** 確定タイミングの決定権を持つチーム。 */
  home: number;
  /** 巻き戻し用に、能力値へ乗せた全ての強化を記録する。 */
  applied: AppliedDelta[] = [];
  /** どのラウンドで確定したか（0=未確定）。 */
  lockedAtRound = 0;

  constructor(private roster: PlayerDef[][], home = 0, seed = Date.now() >>> 0) {
    this.rng = createRng(seed);
    this.deck = freshDeck(this.rng);
    this.home = home;
    this.teams = [newTeam(), newTeam()];
    for (const t of this.teams) t.hand = draw(this.deck, HAND_SIZE);
  }

  /** 未確定でまだ交換の余地があるか（UI がポーカー画面を出すかの判断）。 */
  get active(): boolean { return this.stage !== "done"; }

  /** そのチームがこのラウンドでまだ交換できるか。 */
  canExchange(team: number): boolean {
    return this.stage === "exchange" && !this.teams[team].locked && !this.teams[team].usedThisRound;
  }

  /**
   * 交換する。`picks` は手札のインデックス（捨てる札）、`targets` は同じ並びで
   * 「そのカードの強化を受け取る選手のロスター番号」。捨てた瞬間に個人強化が乗る。
   * 空配列を渡せば「交換しない」（このラウンドの権利は消費する）。
   */
  exchange(team: number, rawPicks: number[], targets: DiscardTarget[]): AppliedDelta[] {
    const st = this.teams[team];
    if (!this.canExchange(team)) return [];
    st.usedThisRound = true;
    const picks = rawPicks.slice(0, MAX_DISCARDS);   // 1回に捨てられる枚数の上限
    const out: AppliedDelta[] = [];
    if (picks.length) {
      st.exchanges++;
      // 大きい添字から抜いて、残す札の位置がずれないようにする
      const order = picks.slice().sort((a, b) => b - a);
      const discarded: { card: Card; target: DiscardTarget }[] = [];
      for (const i of order) {
        const card = st.hand[i];
        if (!card) continue;
        discarded.push({ card, target: targets[picks.indexOf(i)] ?? { team, idx: 0 } });
        st.hand.splice(i, 1);
      }
      for (const d of discarded) {
        const tg = d.target;
        const def = this.roster[tg.team]?.[tg.idx];
        if (!def) continue;
        // 自軍へ置けば強化、相手へ置けば妨害
        const own = tg.team === team;
        const eff = own ? discardEffect(d.card, def.attr) : hinderEffect(d.card, def.attr);
        const got = addAttr(def.attr, eff.key, eff.amount);
        out.push({ team: tg.team, idx: tg.idx, key: eff.key, amount: got,
                   source: "discard", by: team, round: this.round, card: d.card });
        st.log.push(got !== 0
          ? `${cardLabel(d.card)} → ${own ? "" : "相手の "}${def.name} の ${attrName(eff.key)} ${got > 0 ? "+" : ""}${got}`
          : `${cardLabel(d.card)} → ${def.name} は限界で動かず`);
      }
      // 引き直し（デッキが尽きたら切り直す）
      const need = HAND_SIZE - st.hand.length;
      if (this.deck.length < need) this.deck = freshDeck(this.rng);
      st.hand.push(...draw(this.deck, need));
    }
    this.applied.push(...out);
    if (this.teams[0].usedThisRound && this.teams[1].usedThisRound) this.stage = "confirmChoice";
    return out;
  }

  /** 現時点の役（未確定でも計算できる。UI のプレビュー用）。 */
  peek(team: number): HandRank { return evalHand(this.teams[team].hand); }

  /**
   * ホームが「確定」を宣言する。両チームの手が同時に公開され、役の強化が乗る。
   * ラウンド4では持ち越せないので、この呼び出しが自動で行われる。
   */
  confirm(): AppliedDelta[] {
    if (this.stage === "done") return [];
    const out: AppliedDelta[] = [];
    for (let t = 0; t < 2; t++) {
      const st = this.teams[t];
      st.locked = true;
      st.rank = evalHand(st.hand);
      for (const eff of handEffects(st.rank)) {
        for (let i = 0; i < this.roster[t].length; i++) {
          const got = addAttr(this.roster[t][i].attr, eff.key, eff.amount);
          if (got > 0) out.push({ team: t, idx: i, key: eff.key, amount: got,
                                  source: "hand", by: t, round: this.round });
        }
      }
      st.log.push(`役確定: ${st.rank.name} → ${handSummary(st.rank)}`);
    }
    this.applied.push(...out);
    this.lockedAtRound = this.round;
    this.stage = "done";
    return out;
  }

  /** 確定せずに次のクォーターへ持ち越す。ラウンド4なら自動確定する。 */
  carryOver(): AppliedDelta[] {
    if (this.stage === "done") return [];
    if (this.round >= POKER_ROUNDS) return this.confirm();
    this.round++;
    this.stage = "exchange";
    for (const t of this.teams) t.usedThisRound = false;
    return [];
  }

  /** 乗せた強化を全て巻き戻す（試合リセット時。ロスターdefは使い回されるため必須）。 */
  revert(): void {
    for (let i = this.applied.length - 1; i >= 0; i--) {
      const d = this.applied[i];
      const def = this.roster[d.team][d.idx];
      if (def) def.attr[d.key] -= d.amount;
    }
    this.applied = [];
  }

  /** その選手がポーカーで受けた強化の合計（HUD 表示用）。 */
  bonusOf(team: number, idx: number): number {
    let sum = 0;
    for (const d of this.applied) if (d.team === team && d.idx === idx) sum += d.amount;
    return sum;
  }
}

function newTeam(): PokerTeamState {
  return { hand: [], usedThisRound: false, exchanges: 0, locked: false, rank: null, log: [] };
}

/** 能力キー → 日本語名（ログ用）。 */
function attrName(key: AttrKey): string {
  return ATTR_NAME[key] ?? key;
}

const ATTR_NAME: Partial<Record<AttrKey, string>> =
  Object.fromEntries(ATTR_META.map((m) => [m.key, m.name]));
