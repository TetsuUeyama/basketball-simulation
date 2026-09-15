// UI: ポーカー強化の画面。両チーム確定の直後（選手紹介・ティップオフより前）と、
// 各クォーター開始前に挟まる。
//
// 手番:
//   1. **相手（CPU）が先に手を決める** — 捨てる札と、誰を強化/妨害するかまで確定させる。
//      その結果は選手アイコンの下にチップで出るので、ユーザーはそれを見てから決められる。
//   2. ユーザーが「捨てる札」と「置き先の選手」を選んで交換する。
//   3. **ホームが「役を確定する / 持ち越す」を決める**（ホームの特権）。
//   ⚠️ 将来は監督(ヘッドコーチ)の能力で先攻後攻を決める予定。当面は相手が先で固定。
//
// 置いた札＝捨てる札。**1人1枚まで**（同じ選手へ置くと前の札は手札へ戻る）で、
// 1ラウンドに置ける総数は `MAX_DISCARDS` 枚まで。自軍へ置けば強化、相手へ置けば妨害。
import { POKER_OPTS, teamShort } from "../config";
import { ROSTER, ROSTER_SIZE, STARTERS } from "../roster";
import { ATTR_META } from "../attributes";
import type { Player } from "../objects/player/player";
import type { PlayerDef } from "../attributes";
import { PokerMatch, POKER_ROUNDS, HAND_SIZE, type DiscardTarget } from "../poker/state";
import { SUIT_MARK, SUIT_RED, rankLabel, type Card } from "../poker/cards";
import { discardEffect, hinderEffect, MAX_DISCARDS, type AttrKey } from "../poker/effects";
import { cpuPlan, cpuWantsConfirm } from "../poker/ai";
import { scoringPower } from "../roles";
import { rate } from "../util";
import { roleFit, SLOT_POS } from "../ai/lineups";
import { TACTICS } from "../attributes";
import { OFF_BASE_DEFAULT } from "../game";
import { DEF_BASE_DEFAULT } from "../ai/defense/offball";
import { UI, colorOf, INK, BTN_BG } from "./ui";

declare module "./ui" {
  interface UI {
    pokerPanel?: HTMLDivElement;
    pokerStage?: "cpu" | "exchange" | "confirm" | "reveal" | "carry";
    /** 観戦（CPU同士）で、いま手番のチーム。-1 = ホームが確定を判断中。 */
    pokerWatchTurn?: number;
    /** 観戦の待ち時間を飛ばす。 */
    pokerSkip?: (() => void) | null;
    /** 直近の補充で入った枚数（その枚数だけ手札の末尾をアニメで出す）。 */
    pokerFresh: number;
    /** 補充が入ったチーム。観戦では両チームの手札が並ぶので、片方だけ動かす。 */
    pokerFreshTeam?: number;
    /** 手札の添字 → 置いた先（自軍なら強化 / 相手なら妨害）。置く＝捨てる。 */
    pokerTargets: Map<number, DiscardTarget>;
    /** タップ操作で選択中の手札（ドラッグしない環境用）。-1 = なし */
    pokerPicked: number;
    /** 操作モード: カードで強化 / 選手を入れ替え。 */
    pokerMode: "cards" | "swap";
    /** 入れ替えモードで1人目に選んだロスター番号（-1 = 未選択）。 */
    pokerSwapPick: number;
    /** 上段の控え枠に出しているチーム（0/1）。 */
    pokerBenchSide: number;
    /** 表示中の盤: "match" = 試合盤 / 0,1 = そのチームの配置ボード。 */
    pokerBoard: "match" | "off" | "def";
    /** 札を置ける選手アイコン（ドロップ判定に使う）。 */
    pokerSpots: { target: DiscardTarget; el: HTMLElement }[];
    /** ラウンド1が終わったあとに一度だけ走らせる処理（選手紹介 → ティップオフ）。 */
    pokerThen: (() => void) | null;
    beginPoker(then?: () => void): void;
    startMatch(): void;
    openPoker(round: number): void;
    renderPoker(): void;
    finishPokerRound(): void;
  }
}

const ATTR_SHORT = new Map(ATTR_META.map((m) => [m.key, m.label]));

// フルコートの盤（横長）の立ち位置（%）。左半分が相手、右半分が自分。
/** 自分の先発5人（右のリムを攻める並び）。 */
const OWN_SPOT: { x: number; y: number }[] = [
  { x: 60, y: 50 },   // 0 PG — トップ
  { x: 71, y: 16 },   // 1 SG — 上のウイング
  { x: 71, y: 84 },   // 2 SF — 下のウイング
  { x: 84, y: 26 },   // 3 PF — ローポスト
  { x: 87, y: 68 },   // 4 C  — ゴール下
];
/** 相手の先発5人（左右を反転させた鏡像）。 */
const OPP_SPOT: { x: number; y: number }[] = OWN_SPOT.map((s) => ({ x: 100 - s.x, y: s.y }));

/** 試合の頭で新しいポーカーを始める。`then` はラウンド1が終わったら一度だけ走る。 */
UI.prototype.beginPoker = function(then?: () => void): void {
  const g = this.game;
  if (!g) return;
  g.poker?.revert();          // 前の試合の強化を能力値から抜く
  g.poker = new PokerMatch(ROSTER, POKER_OPTS.home, Date.now() >>> 0);
  g.onPokerRound = (round) => this.openPoker(round);
  g.applyRoster();
  this.pokerThen = then ?? null;
  this.openPoker(1);
};

/** そのラウンドを開く。ユーザーが打たない設定ならここで自動解決する。 */
UI.prototype.openPoker = function(round: number): void {
  const g = this.game;
  const m = g?.poker;
  if (!g || !m || !m.active) { this.finishPokerRound(); return; }
  const user = POKER_OPTS.userTeam;
  const opp = user === null ? 1 - m.home : 1 - user;

  this.simPaused = true;
  this.pokerTargets = new Map();
  this.pokerPicked = -1;
  this.pokerMode = "cards";
  this.pokerSwapPick = -1;
  this.pokerBenchSide = POKER_OPTS.userTeam ?? 0;
  this.pokerBoard = "match";
  this.pokerSpots = [];
  this.pokerFresh = 0;
  // まず相手の手番。画面を出してから思考 → 札を置く → 補充、の順に見せる。
  this.pokerStage = user === null ? "cpu"
    : m.canExchange(opp) ? "cpu" : (m.canExchange(user) ? "exchange" : "confirm");
  if (!this.pokerPanel) {
    const p = this.panel();
    Object.assign(p.style, {
      zIndex: "70", gap: "3px", padding: "0 12px 12px", overflowY: "auto",
      justifyContent: "flex-start",   // 中央寄せをやめて上詰めにする
    } as Partial<CSSStyleDeclaration>);
    this.pokerPanel = p;
    this.root.appendChild(p);
  }
  this.pokerPanel.style.display = "flex";
  if (user === null) { runWatchRound(this, m, g); return; }   // 観戦（CPU同士）
  this.renderPoker();
  if (this.pokerStage === "cpu") {
    runCpuTurn(this, m, opp, () => {
      this.pokerStage = m.canExchange(user) ? "exchange" : "confirm";
      this.renderPoker();
    });
  }
  void round;
};

/**
 * ポーカー画面の描画。
 * ⚠️ **プレイヤー対CPUと CPU同士で分岐を作らないこと。** 以前は観戦を `renderWatch` という
 *    別関数で組んでおり、後から足した部品（VSボード・配置ボード・控えの切替など）が
 *    片方にしか入らず UI が食い違った。違いは「操作できるか」だけなので、
 *    `watching` フラグで中身を差し替える形にして**並びは1本**に保つ。
 */
UI.prototype.renderPoker = function(): void {
  const g = this.game;
  const m = g?.poker;
  const p = this.pokerPanel;
  if (!g || !m || !p) return;
  p.replaceChildren();
  this.pokerSpots = [];

  const watching = POKER_OPTS.userTeam === null;       // CPU同士を眺めている
  const view = POKER_OPTS.userTeam ?? m.home;          // 盤の右半分に置くチーム
  const opp = 1 - view;
  const placed = this.pokerTargets;
  const side = this.pokerBenchSide;

  // ---- 見出し（ラウンドと、いま何が起きているか） ----
  p.appendChild(pokerHeader(this, m));

  // ---- VS ボード（戦力値の隣に役） ----
  {
    const vs = this.buildVsBoard();
    vs.style.width = "min(560px, 100%)";
    vs.style.alignSelf = "center";
    p.appendChild(vs);
  }

  // ---- 控え（左のボタンで 自分 ⇄ 相手 を切り替える） ----
  {
    const benchRow = document.createElement("div");
    Object.assign(benchRow.style, {
      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
      width: "100%", flexWrap: "wrap",
    } as Partial<CSSStyleDeclaration>);
    benchRow.append(benchSideToggle(this, view, opp), benchGrid(this, m, side));
    p.appendChild(benchRow);
  }

  // ---- 盤（試合盤 ⇄ 攻撃/守備の配置ボード） ----
  p.appendChild(boardToggle(this, view, opp));
  p.appendChild(this.pokerBoard === "match"
    ? courtBoard(this, m, view)
    : formationBoard(this, watching ? side : view, this.pokerBoard));

  // ---- カード（盤の下）＋ 左右のボタン列 ----
  // ⚠️ 今カードを出している側だけを出す。幅は手札5枚ぶんで固定して、札を置いても
  //    左右のボタンが動かないようにする。相手の伏せ札は飛んでくる札の演出の起点。
  const cards = document.createElement("div");
  Object.assign(cards.style, {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
    minHeight: "68px", justifyContent: "center",
  } as Partial<CSSStyleDeclaration>);
  if (watching) {
    const turn = this.pokerWatchTurn ?? -1;
    if (this.pokerStage === "reveal" || turn < 0) {
      cards.append(opponentArea(this, m, opp), opponentArea(this, m, view));
    } else {
      cards.appendChild(opponentArea(this, m, turn));
    }
  } else if (this.pokerStage === "cpu") {
    cards.appendChild(opponentArea(this, m, opp));
  } else {
    const handRow = document.createElement("div");
    Object.assign(handRow.style, {
      display: "flex", gap: `${CARD_GAP}px`, justifyContent: "center", flexWrap: "wrap",
    } as Partial<CSSStyleDeclaration>);
    m.teams[view].hand.forEach((card, i) => {
      if (placed.has(i)) return;
      handRow.appendChild(handCard(this, card, i));
    });
    cards.appendChild(handRow);
  }
  cards.style.width = `${CARD_W * HAND_SIZE + CARD_GAP * (HAND_SIZE - 1)}px`;
  cards.style.flexShrink = "0";
  {
    const bottom = document.createElement("div");
    Object.assign(bottom.style, {
      display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
      width: "100%", flexWrap: "wrap",
    } as Partial<CSSStyleDeclaration>);
    // 左 = 交換 / 手札公開（観戦ではスキップ）、右 = 操作モードのトグル
    bottom.append(pokerActionCol(this, m, g, view, watching), cards, pokerModeCol(this));
    p.appendChild(bottom);
  }

  // ---- 下段のボタン（公開後の「試合へ」だけ） ----
  const btns = document.createElement("div");
  Object.assign(btns.style, {
    display: "flex", gap: "12px", justifyContent: "center", alignItems: "center", flexWrap: "wrap",
  } as Partial<CSSStyleDeclaration>);
  if (!watching && this.pokerStage === "reveal") {
    const go = this.button("試合へ");
    Object.assign(go.style, { background: colorOf(view), color: INK, fontWeight: "800" } as Partial<CSSStyleDeclaration>);
    go.onclick = () => this.finishPokerRound();
    btns.appendChild(go);
  }
  p.appendChild(btns);
};

// ---- 観戦（CPU 対 CPU）------------------------------------------------------
/**
 * CPU 同士のラウンドを見せながら進める。
 *   アウェイが交換 → ホームが交換 → **ホームが確定タイミングを決める** → 公開 or 持ち越し
 * ⚠️ 手番はホームが**後**。確定の決定権を持つ側が、相手の動きを見てから決められるようにする。
 * ⚠️ 手札は伏せたまま進み、ホームが確定した瞬間に両チームぶんが表になる
 *    （公開のタイミングがホームの権利そのもの）。
 */
function runWatchRound(ui: UI, m: PokerMatch, g: NonNullable<UI["game"]>): void {
  const order = [1 - m.home, m.home];
  const wait = (ms: number, then: () => void): void => {
    const id = window.setTimeout(() => { ui.pokerSkip = null; then(); }, ms);
    ui.pokerSkip = () => { window.clearTimeout(id); ui.pokerSkip = null; then(); };
  };
  const step = (k: number): void => {
    if (k < order.length) {
      const t = order[k];
      ui.pokerWatchTurn = t;
      ui.pokerStage = "cpu";
      ui.renderPoker();
      if (!m.canExchange(t)) { step(k + 1); return; }
      runCpuTurn(ui, m, t, () => step(k + 1));
      return;
    }
    ui.pokerWatchTurn = -1;
    if (cpuWantsConfirm(m)) {
      m.confirm();
      announceHands(m, g);
      g.applyRoster();
      ui.pokerStage = "reveal";
      ui.renderPoker();
      wait(POKER_OPTS.revealMs, () => ui.finishPokerRound());
    } else {
      m.carryOver();
      ui.pokerStage = "carry";
      ui.renderPoker();
      wait(POKER_OPTS.carryMs, () => ui.finishPokerRound());
    }
  };
  step(0);
}

/** 観戦の画面。両チームを上下に並べ、真ん中の盤に置かれた札（強化/妨害）が出る。 */
/**
 * 観戦（CPU同士）の描画。
 * ⚠️ プレイ時と**同じ部品・同じ並び**で組む。以前はここだけ独自の並びで、
 *    配置ボードも控えのトグルも無く、UI が食い違っていた。
 *    違うのは「操作できない」ことだけ（編集の可否は各部品が userTeam を見て決める）。
 */

/** 見出し: ラウンドと、いま何が起きているか。 */
function pokerHeader(ui: UI, m: PokerMatch): HTMLDivElement {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex", gap: "10px", alignItems: "baseline", justifyContent: "center",
    fontSize: "clamp(12px,2.8vw,15px)", fontWeight: "800", letterSpacing: "1px",
  } as Partial<CSSStyleDeclaration>);
  const r = document.createElement("span");
  r.textContent = `ポーカー強化  ラウンド ${m.round} / ${POKER_ROUNDS}`;
  // ⚠️ 旧 teamStrip が出していた「公開の決定権はホーム」をここへ集約した。
  const h = document.createElement("span");
  h.textContent = `公開の決定権: ${teamShort(m.home)}`;
  Object.assign(h.style, {
    fontSize: "10px", opacity: "0.7", fontWeight: "700", color: colorOf(m.home),
  } as Partial<CSSStyleDeclaration>);
  const s = document.createElement("span");
  const turn = ui.pokerWatchTurn ?? -1;
  s.textContent = ui.pokerStage === "reveal" ? "役を公開"
    : ui.pokerStage === "carry" ? "ホームは持ち越しを選択"
    : turn >= 0 ? `${teamLabel(turn, m)} が交換中`
    : "ホームが確定を判断中";
  Object.assign(s.style, {
    fontSize: "11px", opacity: "0.85",
    color: turn >= 0 ? colorOf(turn) : "#fff",
  } as Partial<CSSStyleDeclaration>);
  row.append(r, s, h);
  return row;
}



/** チームの呼び名（ホーム/アウェイ）。 */
function teamLabel(team: number, m: PokerMatch): string {
  return team === m.home ? "ホーム" : "アウェイ";
}

/** ラウンドを閉じて試合へ戻す。 */
UI.prototype.finishPokerRound = function(): void {
  if (this.pokerPanel) this.pokerPanel.style.display = "none";
  this.pokerSkip = null;
  this.pokerWatchTurn = -1;
  this.simPaused = false;
  this.game?.applyRoster();
  this.game?.resumeFromPoker();
  const then = this.pokerThen;
  this.pokerThen = null;
  if (then) then();          // ラウンド1のあとだけ: 選手紹介 → ティップオフ
};

// ---- 部品 -----------------------------------------------------------------

/**
 * 相手（CPU）の手番を見せる。
 *   思考時間 → 捨てる札を1枚ずつ選手の上へ運ぶ → 交換を適用 → 補充した札が手札に入る
 * 見せ終わったら `done` を呼ぶ。
 */
function runCpuTurn(ui: UI, m: PokerMatch, cpu: number, done: () => void): void {
  const plan = cpuPlan(m, cpu, ROSTER);
  const hand = m.teams[cpu].hand;
  const cards = plan.picks.map((i) => hand[i]);

  const apply = (): void => {
    m.exchange(cpu, plan.picks, plan.targets);
    ui.game?.applyRoster();
    cpuAdjustSquad(ui, m, cpu);          // CPU も編成と役割を手当てする
    cpuAssignDefense(cpu);               // 相手の能力を見て守備の割り当てを決める
    ui.pokerFresh = plan.picks.length;   // 補充ぶんをアニメで出す
    ui.pokerFreshTeam = cpu;             // ⚠️ 観戦では両チームの札が並ぶ。打った側だけ動かす
    ui.renderPoker();
    ui.pokerFresh = 0;
    // 補充が入り切ってから手番を渡す（すぐ再描画するとアニメが途中で消える）
    window.setTimeout(done, POKER_OPTS.dealMs + plan.picks.length * 70);
  };

  if (!plan.picks.length) { window.setTimeout(apply, POKER_OPTS.thinkMs); return; }

  // 思考時間のあいだ、相手の伏せ札を軽く上下させて「考えている」ことを見せる
  const think = ui.pokerPanel?.querySelectorAll<HTMLElement>(
    `[data-oppcard][data-oppteam="${cpu}"]`) ?? [];
  think.forEach((el, k) => {
    el.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-5px)" }, { transform: "translateY(0)" }],
      { duration: Math.max(300, POKER_OPTS.thinkMs), iterations: 1, delay: k * 60, easing: "ease-in-out" },
    );
  });

  window.setTimeout(() => {
    let k = 0;
    const step = (): void => {
      if (k >= cards.length) { apply(); return; }
      flyCardToTarget(ui, cards[k], cpu, plan.targets[k], plan.picks[k]);
      k++;
      window.setTimeout(step, POKER_OPTS.stepMs);
    };
    step();
  }, POKER_OPTS.thinkMs);
}

/** 相手の札1枚が、手札の位置から置き先の選手の上へ飛んでいく見せ方。 */
function flyCardToTarget(ui: UI, card: Card, cpu: number, target: DiscardTarget, handSlot: number): void {
  const panel = ui.pokerPanel;
  if (!panel || !card) return;
  const sel = `[data-oppcard][data-oppteam="${cpu}"]`;
  const from = panel.querySelectorAll<HTMLElement>(sel)[handSlot]
    ?? panel.querySelector<HTMLElement>(sel);
  const spot = ui.pokerSpots.find((s) => s.target.team === target.team && s.target.idx === target.idx)
    ?? { el: panel };
  const a = (from ?? panel).getBoundingClientRect();
  const b = spot.el.getBoundingClientRect();

  const ghost = cardFace(card, 30, 42);   // 何を捨てたかは見せる（手札の中身は伏せたまま）
  Object.assign(ghost.style, {
    position: "fixed", left: "0", top: "0", zIndex: "96", pointerEvents: "none",
    willChange: "transform", border: `1px solid ${colorOf(cpu)}`,
    transform: `translate3d(${a.left + a.width / 2}px, ${a.top + a.height / 2}px, 0) translate(-50%,-50%)`,
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);
  const anim = ghost.animate([
    { transform: `translate3d(${a.left + a.width / 2}px, ${a.top + a.height / 2}px, 0) translate(-50%,-50%) scale(1)` },
    { transform: `translate3d(${b.left + b.width / 2}px, ${b.top + b.height / 2}px, 0) translate(-50%,-50%) scale(0.62)`, opacity: 0.15 },
  ], { duration: Math.max(160, POKER_OPTS.stepMs - 60), easing: "cubic-bezier(0.2,0.7,0.3,1)", fill: "forwards" });
  anim.onfinish = () => ghost.remove();
  // 受け取った選手を一瞬光らせる
  spot.el.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.7)" }, { filter: "brightness(1)" }],
    { duration: 420, delay: Math.max(120, POKER_OPTS.stepMs - 120) });
}

/** 役が確定したことをコート上のバナーで知らせる（プレー再開と同時に出る）。 */
function announceHands(m: PokerMatch, g: NonNullable<UI["game"]>): void {
  const home = m.teams[m.home].rank;
  if (home) g.setEvent("POKER: " + home.name, m.home, 3.2);
}

/** 相手（ホーム CPU）が確定タイミングを決める。 */
function cpuHomeDecides(ui: UI, m: PokerMatch, g: NonNullable<UI["game"]>): void {
  if (cpuWantsConfirm(m)) {
    m.confirm();
    announceHands(m, g);
    g.applyRoster();
    ui.pokerStage = "reveal";
    ui.renderPoker();
  } else {
    m.carryOver();
    ui.finishPokerRound();
  }
}

/**
 * 相手の段（画面の一番上）。伏せた手札5枚と、妨害を置ける相手の先発5人。
 * 役が確定したら伏せ札は表になる。
 */
function opponentArea(ui: UI, m: PokerMatch, opp: number): HTMLDivElement {
  const area = document.createElement("div");
  Object.assign(area.style, {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
    width: "100%", paddingBottom: "8px",
    borderBottom: "1px solid rgba(255,255,255,0.14)",
  } as Partial<CSSStyleDeclaration>);

  const hand = document.createElement("div");
  Object.assign(hand.style, { display: "flex", gap: "5px", justifyContent: "center" } as Partial<CSSStyleDeclaration>);
  const revealed = m.teams[opp].locked;
  const cards = m.teams[opp].hand;
  const freshFrom = cards.length - ui.pokerFresh;   // これ以降が補充された札
  cards.forEach((c, i) => {
    const el = revealed ? cardFace(c, 30, 42) : cardBack(30, 42, opp);
    // ⚠️ 観戦では**両チーム**の伏せ札が並ぶので、チーム印が無いと相手の札から飛ばしてしまう。
    el.dataset.oppcard = String(i);                 // 飛ばす札の始点に使う
    el.dataset.oppteam = String(opp);
    if (ui.pokerFresh > 0 && (ui.pokerFreshTeam ?? opp) === opp && i >= freshFrom) {
      el.animate([{ opacity: 0, transform: "translateY(-14px) rotate(-8deg)" },
                  { opacity: 1, transform: "none" }],
                 { duration: POKER_OPTS.dealMs, delay: (i - freshFrom) * 70, easing: "ease-out", fill: "backwards" });
    }
    hand.appendChild(el);
  });
  area.appendChild(hand);

  // ⚠️ 相手の控え8人は**上段の控え枠へ移した**（自分/相手をトグルで切り替える）。
  //    ここに置くとカード欄の下に控えがもう1つ並んで二重になる。

  return area;
}

/** 伏せた札。相手チームカラーの裏模様。 */
function cardBack(w: number, h: number, team: number): HTMLDivElement {
  const el = document.createElement("div");
  const c = colorOf(team);
  Object.assign(el.style, {
    width: `${w}px`, height: `${h}px`, borderRadius: "6px", flexShrink: "0",
    background: `repeating-linear-gradient(45deg, ${c} 0 4px, rgba(12,15,22,0.9) 4px 8px)`,
    border: "1px solid rgba(255,255,255,0.35)", boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
  } as Partial<CSSStyleDeclaration>);
  return el;
}

/**
 * ハーフコートの盤（先発5人が立ち位置に並ぶ）と、その横に控え8人。
 * 13人の誰にでも札を置ける。狭い画面では控えが盤の下へ回り込む。
 */
function courtBoard(ui: UI, m: PokerMatch, team: number): HTMLDivElement {
  const opp = 1 - team;
  const board = document.createElement("div");
  Object.assign(board.style, {
    position: "relative", width: "min(470px, 94vw)", aspectRatio: "28 / 15",
    background: "linear-gradient(180deg, rgba(44,38,30,0.95), rgba(30,26,21,0.95))",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
    flexShrink: "0", margin: "2px 0 2px",   // カード欄との隙間を詰める
  } as Partial<CSSStyleDeclaration>);
  board.innerHTML = COURT_SVG;
  // mirror=true なら役割ピルを顔の**左**へ出す（盤の左半分＝相手側）。
  const put = (t: number, i: number, spot: { x: number; y: number }, mirror = false): void => {
    const cell = playerCell(ui, m, t, i, 34, mirror);
    Object.assign(cell.style, {
      position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`,
      transform: "translate(-50%,-50%)",
    } as Partial<CSSStyleDeclaration>);
    board.appendChild(cell);
  };
  for (let i = 0; i < STARTERS; i++) put(opp, i, OPP_SPOT[i], true);   // 相手は左半分（ピルも左）
  for (let i = 0; i < STARTERS; i++) put(team, i, OWN_SPOT[i]);  // 自分は右半分
  return board;
}

/** 控え8人。手札の下に4列×2段で並べる。 */
function benchGrid(ui: UI, m: PokerMatch, team: number): HTMLDivElement {
  const bench = document.createElement("div");
  Object.assign(bench.style, {
    display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: "1px 10px",
    justifyContent: "center", alignContent: "center",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px", padding: "1px 8px",   // 上下の隙間をほぼ無くす
  } as Partial<CSSStyleDeclaration>);
  for (let i = STARTERS; i < ROSTER_SIZE; i++) bench.appendChild(playerCell(ui, m, team, i, 30));
  return bench;
}

/** 手札1枚の寸法。カード欄の幅を固定するのにも使う。 */
const CARD_W = 44, CARD_H = 62;
/** 手札どうしの間隔。 */
const CARD_GAP = 8;
/** 置いた札の1行ぶんの高さ。札が無くても同じ高さを空けておく。 */
const CHIP_H = 13;

/** 既に適用された増減（相手が先に打った手／自分の交換の結果）。枠線が打った側の色。 */
function doneChip(by: number, key: AttrKey, amount: number): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    display: "flex", alignItems: "center",
    background: "rgba(12,15,22,0.8)", border: "1px solid " + colorOf(by),
    borderRadius: "6px", padding: "0 4px", fontSize: "9px", fontWeight: "800",
    height: `${CHIP_H}px`, lineHeight: "1", whiteSpace: "nowrap", opacity: "0.9",
    color: amount < 0 ? "rgb(255,120,120)" : "rgb(120,225,140)",
  } as Partial<CSSStyleDeclaration>);
  const label = ATTR_SHORT.get(key) ?? "";
  el.textContent = amount >= 0 ? `${label}+${amount}` : `${label}${amount}`;
  return el;
}

/**
 * 札を落とせる選手ひとり分（先発・控え・相手選手すべて同じ作り）。
 * `team` が操作中のチームなら強化、相手チームなら妨害になる。
 */
function playerCell(ui: UI, m: PokerMatch, team: number, idx: number, size: number,
                    mirror = false): HTMLDivElement {
  // 表示するピルは盤のタブで決まる。試合タブでは出さない（カード強化と選手交代だけ）。
  const pillMode: "off" | "def" | "none" =
    ui.pokerBoard === "off" ? "off" : ui.pokerBoard === "def" ? "def" : "none";
  const user = POKER_OPTS.userTeam ?? 0;
  const own = team === user;
  const cell = document.createElement("div");
  Object.assign(cell.style, {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
    pointerEvents: "auto", cursor: "pointer",
  } as Partial<CSSStyleDeclaration>);

  const face = document.createElement("div");
  Object.assign(face.style, {
    position: "relative", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
    overflow: "hidden", border: `2px solid ${colorOf(team)}`,
    boxShadow: "0 2px 8px rgba(0,0,0,0.55)", background: "rgba(20,24,34,0.9)",
  } as Partial<CSSStyleDeclaration>);
  const pl: Player | undefined = ui.game?.roster[team][idx];
  if (pl) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    Object.assign(canvas.style, { width: `${size}px`, height: `${size}px`, display: "block" } as Partial<CSSStyleDeclaration>);
    ui.drawFace(canvas, pl);
    face.appendChild(canvas);
  }
  // ここまでに能力が動いている選手は縁を光らせる（試合中の HUD と同じ合図）。
  const bonus = m.bonusOf(team, idx, "discard");
  if (bonus !== 0) {
    const col = bonus > 0 ? "255,206,92" : "255,110,110";
    face.style.border = "2px solid rgb(" + col + ")";
    face.style.boxShadow = "0 0 0 1px rgba(" + col + ",0.55), 0 0 10px 2px rgba(" + col + ",0.5)";
  }
  const def = ROSTER[team][idx];
  // 顔の**右横**に役割ピルを縦並びで置く（1段目: 攻ロール＋オフェンス順位 / 2段目: 守ロール）。
  {
    const headRow = document.createElement("div");
    Object.assign(headRow.style, {
      display: "flex", alignItems: "center", gap: "4px",
    } as Partial<CSSStyleDeclaration>);
    // 盤の左半分の選手は、顔の左にピルを出して中央を空ける。
    if (pillMode === "none") {
      headRow.appendChild(face);
    } else if (mirror) {
      headRow.appendChild(rolePills(ui, def, team, size, true, pillMode));
      headRow.appendChild(face);
    } else {
      headRow.appendChild(face);
      headRow.appendChild(rolePills(ui, def, team, size, false, pillMode));
    }
    cell.appendChild(headRow);
  }
  const name = document.createElement("div");
  name.textContent = `${def.role} ${def.name}`;
  Object.assign(name.style, {
    fontSize: size >= 40 ? "9px" : "8px", fontWeight: "700",
    maxWidth: size >= 40 ? "94px" : "78px", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 3px rgba(0,0,0,0.9)",
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(name);

  // 役割ピル: 攻ロール / オフェンス選択順位 / 守ロール。自分のチームだけ操作できる。

  // 名前の下の1行。高さは札が無くても最初から確保し、中身は絶対配置にして
  // セルの幅にも影響させない（置いても・相手が動いても配置がずれない）。
  const slot = document.createElement("div");
  Object.assign(slot.style, {
    height: `${CHIP_H}px`, marginTop: "1px", position: "relative", width: "100%",
  } as Partial<CSSStyleDeclaration>);
  const chipRow = document.createElement("div");
  Object.assign(chipRow.style, {
    position: "absolute", top: "0", left: "50%", transform: "translateX(-50%)",
    display: "flex", gap: "3px", whiteSpace: "nowrap",
  } as Partial<CSSStyleDeclaration>);
  slot.appendChild(chipRow);
  cell.appendChild(slot);

  // このラウンドで**既に適用された**増減（相手が先に打った手、および自分の交換の結果）。
  for (const d of m.applied) {
    if (d.source !== "discard" || d.round !== m.round) continue;
    if (d.team !== team || d.idx !== idx) continue;
    chipRow.appendChild(doneChip(d.by, d.key, d.amount));
  }

  // この選手に置かれている札とその効果（1人1枚）。自軍なら強化、相手なら妨害。
  for (const [handIdx, target] of ui.pokerTargets) {
    if (target.team !== team || target.idx !== idx) continue;
    const card = m.teams[user].hand[handIdx];
    const eff = own ? discardEffect(card, def.attr) : hinderEffect(card, def.attr);
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      display: "flex", alignItems: "center", gap: "3px", pointerEvents: "auto",
      background: "rgba(12,15,22,0.92)", border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: "6px", padding: "0 4px", fontSize: "9px", fontWeight: "800",
      height: `${CHIP_H}px`, lineHeight: "1", whiteSpace: "nowrap",
    } as Partial<CSSStyleDeclaration>);
    const mark = document.createElement("span");
    mark.textContent = `${SUIT_MARK[card.suit]}${rankLabel(card.rank)}`;
    mark.style.color = SUIT_RED[card.suit] ? "#ff6b72" : "#e6e9f0";
    const gain = document.createElement("span");
    const label = ATTR_SHORT.get(eff.key) ?? "";
    gain.textContent = eff.amount === 0 ? "限界"
      : eff.amount > 0 ? `${label}+${eff.amount}` : `${label}${eff.amount}`;
    gain.style.color = eff.amount < 0 ? "rgb(255,120,120)" : "rgb(120,225,140)";
    chip.append(mark, gain);
    chip.onclick = (e) => {            // 置いた札はタップで手札へ戻す
      e.stopPropagation();
      ui.pokerTargets.delete(handIdx);
      ui.renderPoker();
    };
    chipRow.appendChild(chip);
  }

  if (ui.pokerStage === "exchange" || ui.pokerStage === "cpu") {
    const target: DiscardTarget = { team, idx };
    ui.pokerSpots.push({ target, el: cell });   // 相手の札が飛んでくる先にも使う
    if (ui.pokerStage === "exchange") {
      cell.onclick = () => {
        // 入れ替えモード: 1人目を選び、2人目で先発⇄控えを交換する。
        if (ui.pokerMode === "swap") {
          if (POKER_OPTS.userTeam === null || team !== POKER_OPTS.userTeam) return;
          if (ui.pokerSwapPick < 0) { ui.pokerSwapPick = idx; ui.renderPoker(); return; }
          if (ui.pokerSwapPick !== idx) swapRosterSlots(ui, m, team, ui.pokerSwapPick, idx);
          ui.pokerSwapPick = -1;
          ui.renderPoker();
          return;
        }
        // 札を持たずに顔を叩いたら選手詳細を開く（選手一覧を廃した代わりの入口）。
        if (ui.pokerPicked < 0) { ui.openDetailModal(ROSTER[team][idx], team); return; }
        placeCard(ui, ui.pokerPicked, target);
        ui.pokerPicked = -1;
        ui.renderPoker();
      };
      if (ui.pokerMode === "swap" && ui.pokerSwapPick === idx) {
        cell.style.outline = "2px solid rgb(120,225,140)";   // 1人目に選んだ印
        cell.style.borderRadius = "8px";
      }
    } else {
      cell.style.cursor = "default";
    }
  }
  return cell;
}

/** 手札の1枚。ドラッグして選手へ落とす / タップで選んでから選手を叩く。 */
function handCard(ui: UI, card: Card, i: number): HTMLDivElement {
  const el = cardFace(card, CARD_W, CARD_H);
  el.style.pointerEvents = "auto";
  if (ui.pokerStage !== "exchange") return el;
  el.style.cursor = "grab";
  if (ui.pokerPicked === i) {
    Object.assign(el.style, {
      transform: "translateY(-6px)", outline: `3px solid ${colorOf(POKER_OPTS.userTeam ?? 0)}`,
    } as Partial<CSSStyleDeclaration>);
  }
  el.onclick = () => {
    ui.pokerPicked = ui.pokerPicked === i ? -1 : i;
    ui.renderPoker();
  };
  el.onpointerdown = (ev) => beginCardDrag(ui, card, i, ev);
  return el;
}

/**
 * 札を選手へ置く（＝捨てて強化する予約）。**1人1枚**なので、既にその選手へ置いてある
 * 札は手札へ戻して置き換える。全体の枚数上限に達していたら何もしない。
 */
function placeCard(ui: UI, handIdx: number, target: DiscardTarget): void {
  for (const [other, t] of ui.pokerTargets) {
    if (t.team === target.team && t.idx === target.idx && other !== handIdx) ui.pokerTargets.delete(other);
  }
  if (!ui.pokerTargets.has(handIdx) && ui.pokerTargets.size >= MAX_DISCARDS) return;
  ui.pokerTargets.set(handIdx, target);
}

/** カードのドラッグ。指/カーソルに追従する影を出し、離した位置の選手へ置く。 */
function beginCardDrag(ui: UI, card: Card, i: number, ev: PointerEvent): void {
  if (ev.button !== undefined && ev.button !== 0) return;
  // 影は小さめ（指やカーソルの下を隠さない大きさ）。
  const at = (x: number, y: number): string =>
    `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%,-50%) rotate(-4deg)`;
  // 影は最初に動いた時に作る（ただのタップでちらつかせない）。
  let ghost: HTMLDivElement | null = null;
  const showGhost = (x: number, y: number): void => {
    if (ghost) return;
    ghost = cardFace(card, 34, 48);
    Object.assign(ghost.style, {
      position: "fixed", left: "0", top: "0", zIndex: "95", pointerEvents: "none",
      opacity: "0.95", willChange: "transform", transform: at(x, y),
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
  };
  // ポインタを捕捉して、指が要素の外へ出ても move が途切れないようにする。
  const src = ev.currentTarget as Element | null;
  try { src?.setPointerCapture(ev.pointerId); } catch { /* 未対応環境では無視 */ }

  // ドロップ先の矩形はドラッグ中に動かないので、開始時に一度だけ測る
  // （毎フレームの getBoundingClientRect はレイアウトを起こして追従を鈍らせる）。
  const spots = ui.pokerSpots.map((s) => ({ ...s, r: s.el.getBoundingClientRect() }));
  let moved = false;
  let hot: HTMLElement | null = null;

  const hit = (x: number, y: number): { target: DiscardTarget; el: HTMLElement } | null => {
    for (const s of spots) {
      // 落としやすいように判定を少し広く取る
      if (x >= s.r.left - 12 && x <= s.r.right + 12 && y >= s.r.top - 12 && y <= s.r.bottom + 12) return s;
    }
    return null;
  };
  const move = (e: PointerEvent): void => {
    moved = true;
    showGhost(e.clientX, e.clientY);
    // transform だけを触る（再レイアウトが起きないので指に遅れずついてくる）
    ghost!.style.transform = at(e.clientX, e.clientY);
    const s = hit(e.clientX, e.clientY);
    if (hot && hot !== s?.el) hot.style.filter = "";
    hot = s ? s.el : null;
    if (hot) hot.style.filter = "brightness(1.35)";
  };
  const cleanup = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointercancel", cancel);
    try { src?.releasePointerCapture(ev.pointerId); } catch { /* 既に解放済み */ }
    ghost?.remove();
    if (hot) hot.style.filter = "";
  };
  const cancel = (): void => { cleanup(); ui.renderPoker(); };
  const up = (e: PointerEvent): void => {
    const s = hit(e.clientX, e.clientY);
    cleanup();
    if (s) {
      placeCard(ui, i, s.target);
      ui.pokerPicked = -1;
      ui.renderPoker();
    } else if (moved) {
      ui.renderPoker();      // どこにも落ちなかった: 影を消して描き直すだけ
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("pointerup", up, { once: true });
}

/** 札の見た目。 */
function cardFace(card: Card, w: number, h: number): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "relative", width: `${w}px`, height: `${h}px`, borderRadius: "8px",
    background: "#f3f5f9", color: SUIT_RED[card.suit] ? "#c8202a" : "#15181f",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontWeight: "800", boxShadow: "0 3px 10px rgba(0,0,0,0.45)", lineHeight: "1.05",
    flexShrink: "0", touchAction: "none", userSelect: "none",
  } as Partial<CSSStyleDeclaration>);
  const r = document.createElement("div");
  r.textContent = rankLabel(card.rank);
  r.style.fontSize = `${Math.round(h * 0.30)}px`;
  const s = document.createElement("div");
  s.textContent = SUIT_MARK[card.suit];
  s.style.fontSize = `${Math.round(h * 0.28)}px`;
  el.append(r, s);
  return el;
}

// フルコートのライン（28m×15m を 280×150 で描く。横長、左右に1つずつリム）。
const COURT_SVG = `
<svg viewBox="0 0 280 150" preserveAspectRatio="none"
     style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
  <g fill="none" stroke="rgba(255,255,255,0.40)" stroke-width="1.4">
    <rect x="2" y="2" width="276" height="146"/>
    <line x1="140" y1="2" x2="140" y2="148"/>
    <circle cx="140" cy="75" r="18"/>
    <rect x="2" y="50.5" width="58" height="49"/>
    <rect x="220" y="50.5" width="58" height="49"/>
    <circle cx="60" cy="75" r="18"/>
    <circle cx="220" cy="75" r="18"/>
    <circle cx="15" cy="75" r="4.5"/>
    <circle cx="265" cy="75" r="4.5"/>
    <line x1="8" y1="66" x2="8" y2="84"/>
    <line x1="272" y1="66" x2="272" y2="84"/>
    <path d="M 2,9 L 30,9 A 70 70 0 0 1 30,141 L 2,141"/>
    <path d="M 278,9 L 250,9 A 70 70 0 0 0 250,141 L 278,141"/>
  </g>
</svg>`;

// ============================================================================
// 選手一覧を廃した代わりに、ポーカー画面のセルへ役割設定と入れ替えを持たせる。
// ============================================================================

/** 小さなピル。セル幅に収まるよう文字も詰める。 */
function miniPill(text: string, active: boolean, accent: string, title: string,
                  enabled: boolean, small: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  Object.assign(b.style, {
    fontSize: small ? "8px" : "9px", fontWeight: active ? "800" : "600",
    padding: small ? "1px 3px" : "1px 4px", borderRadius: "8px", lineHeight: "1.25",
    cursor: enabled ? "pointer" : "default", whiteSpace: "nowrap",
    background: active ? accent : BTN_BG,
    color: active ? "#101319" : "rgba(255,255,255,0.5)",
    border: active ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.16)",
    opacity: enabled ? "1" : "0.55",
  } as Partial<CSSStyleDeclaration>);
  b.onpointerdown = (e) => e.stopPropagation();
  b.onclick = (e) => { e.stopPropagation(); if (enabled) onClick(); };
  return b;
}

/** 攻ロール / オフェンス選択順位 / 守ロール の3ピル。自分のチームだけ操作できる。 */
/**
 * 役割ピル。`mode` でどれを出すか決める。
 *  "off"  … 攻ロール + オフェンス順位（攻撃タブ）
 *  "def"  … 守ロール（守備タブ）
 *  "all"  … 両方
 * ⚠️ 試合タブでは呼ばない（カード強化と選手交代だけに絞るため）。
 */
function rolePills(ui: UI, def: PlayerDef, team: number, size: number,
                   mirror = false, mode: "off" | "def" | "all" = "all"): HTMLDivElement {
  const row = document.createElement("div");
  const small = size < 40;
  // 顔の右横に置く縦並び。攻撃側は「攻ロール + 順位」で1段、守備側は「守ロール」で1段。
  Object.assign(row.style, {
    display: "flex", flexDirection: "column", gap: "2px",
    alignItems: mirror ? "flex-end" : "flex-start",
  } as Partial<CSSStyleDeclaration>);
  const on = POKER_OPTS.userTeam !== null && team === POKER_OPTS.userTeam;
  const offC = (def.evalRole && UI.OFF_GROUP_C[def.evalRole]) || "rgba(255,255,255,0.28)";
  const defC = (def.defRole && UI.DEF_GROUP_C[def.defRole]) || "rgba(255,255,255,0.28)";
  const offP = miniPill(def.evalRole ? (UI.EVAL_ROLES[def.evalRole]?.short ?? "?") : "攻-",
    !!def.evalRole, offC, "オフェンスロール", on, small,
    () => ui.openRolePicker(def, team, offP, () => ui.renderPoker(), "off"));
  // 選択順位は攻ロールの隣。タップで 1→2→…→5→自動 と回る。
  const rankP = miniPill(def.choiceRank ? String(def.choiceRank) : "自",
    !!def.choiceRank, "rgb(120,225,140)", "オフェンス選択順位（1=最優先 / 自=能力で自動）", on, small,
    () => {
      def.choiceRank = def.choiceRank === undefined ? 1 : def.choiceRank >= 5 ? undefined : def.choiceRank + 1;
      ui.renderPoker();
    });
  const defP = miniPill(def.defRole ? (UI.DEF_ROLES[def.defRole]?.short ?? "?") : "守-",
    !!def.defRole, defC, "ディフェンスロール", on, small,
    () => ui.openRolePicker(def, team, defP, () => ui.renderPoker(), "def"));
  if (mode === "off") {
    // 攻撃タブ: 攻ロールの**下**にオフェンス順位を縦並びで置く。
    row.append(offP, rankP);
  } else if (mode === "def") {
    // 守備タブ: 守ロールの**下**に「ゾーン/マン」、**その横**にマーク相手を並べる。
    const line2 = document.createElement("div");
    Object.assign(line2.style, { display: "flex", gap: "2px" } as Partial<CSSStyleDeclaration>);
    line2.append(...defAssignPills(ui, def, team, small));
    row.append(defP, line2);
  } else {
    const line1 = document.createElement("div");
    Object.assign(line1.style, { display: "flex", gap: "2px" } as Partial<CSSStyleDeclaration>);
    // 左側のチーム（mirror）は、オフェンス順位を攻ロールの**左**へ。
    if (mirror) line1.append(rankP, offP); else line1.append(offP, rankP);
    row.append(line1, defP);
  }
  return row;
}

/**
 * ロスターの2枠を入れ替える（先発⇄控え）。
 * ⚠️ ポーカーの強化は `applied[].idx` の**インデックス管理**なので、枠を入れ替えたら
 *    記録側の idx も付け替えないと `revert()` が別人から能力を引く。
 *    置きかけの札（pokerTargets）も同じ理由で付け替える。
 */
function swapRosterSlots(ui: UI, m: PokerMatch, team: number, a: number, b: number): void {
  const r = ROSTER[team];
  [r[a], r[b]] = [r[b], r[a]];
  for (const d of m.applied) {
    if (d.team !== team) continue;
    if (d.idx === a) d.idx = b; else if (d.idx === b) d.idx = a;
  }
  // ⚠️ コート上の5人は applyRoster で確定しているので、枠を入れ替えたら組み直す。
  //    **`onPrepare()` を呼んではいけない**。その中の `game.reset()` は試合まるごとの
  //    リセットで、score / qLine / quarter / gameClock まで初期化してしまう
  //    （実害: クォーター間のポーカーで入れ替えが起きると 1Q の得点が 0 に戻った）。
  //    ここで必要なのはロスターの組み直しだけ。
  ui.game?.applyRoster();
  for (const t of ui.pokerTargets.values()) {
    if (t.team !== team) continue;
    if (t.idx === a) t.idx = b; else if (t.idx === b) t.idx = a;
  }
}

/**
 * 試合を始める。旧・前試合画面（選手一覧）を廃したので、クラブ選択と再戦から
 * **直接ここへ入る**。役割設定・先発入れ替え・VSボードはポーカー画面側へ移設済み。
 * ⚠️ 旧 `tipOffButton` と同じ3手順を保つこと（コート配置 → ポーカー → ティップオフ）。
 */
UI.prototype.startMatch = function(): void {
  this.setPhase("playing");
  this.onPrepare();                       // 両チーム確定 → コートに並べる
  this.beginPoker(() => this.onStart());  // ポーカー → 選手紹介 → ティップオフ
};

/**
 * 上段のボタン行。左から
 *   [交換しない / N枚 交換] [カードで強化] [選手を入れ替え] [手札公開]
 * 中央2つが操作モードのトグル、両脇が確定タイミングの選択。
 * ⚠️ 両脇はそれぞれのフェーズでだけ押せる（左=交換フェーズ / 右=確定フェーズ）。
/** カード欄の左右に置くボタン列の共通の器。 */
function btnCol(): HTMLDivElement {
  const col = document.createElement("div");
  Object.assign(col.style, {
    display: "flex", flexDirection: "column", gap: "5px", alignItems: "stretch",
    justifyContent: "center", minWidth: "104px",
  } as Partial<CSSStyleDeclaration>);
  return col;
}

/**
 * カード欄の**左**。交換の実行と手札公開。
 * ⚠️ それぞれのフェーズでだけ押せる（交換=交換フェーズ / 手札公開=確定フェーズ）。
 *    列幅がフェーズで変わらないよう、押せない間も場所を確保して薄く出す。
 */
function pokerActionCol(ui: UI, m: PokerMatch, g: NonNullable<UI["game"]>, user: number,
                        watching = false): HTMLDivElement {
  const col = btnCol();
  const side = (label: string, enabled: boolean, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      padding: "4px 12px", borderRadius: "9px", fontSize: "11px", fontWeight: "800",
      cursor: enabled ? "pointer" : "default", color: "#fff",
      background: enabled ? colorOf(user) : BTN_BG,
      border: enabled ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.14)",
      opacity: enabled ? "1" : "0.35",
    } as Partial<CSSStyleDeclaration>);
    if (enabled) { b.style.color = INK; b.onclick = onClick; }
    return b;
  };

  // 次のクォーターへ持ち越す（役を確定させない）。
  const carry = (): void => { m.carryOver(); ui.finishPokerRound(); };

  // 上のボタンは局面で役割が変わる。
  //   交換フェーズ・札あり … 「N枚 交換」= 置いた札を切る
  //   交換フェーズ・札なし … 「交換しない」= **確定させず次のクォーターへ持ち越す**
  //   確定フェーズ       … 「継続」      = 公開せず次のクォーターへ持ち越す
  // ⚠️ どちらの局面でも「持ち越し」を選べるようにしておくこと。手札公開しか選べないと
  //    確定タイミングを握っている意味が無くなる。
  // 観戦(CPU同士)では自分が打たないので、この列はスキップだけにする。
  if (watching) {
    col.appendChild(side("スキップ", true, () => ui.pokerSkip?.()));
    return col;
  }
  const canCarry = m.round < POKER_ROUNDS;
  const n = ui.pokerTargets.size;
  if (ui.pokerStage === "exchange") {
    col.appendChild(side(n ? `${n}枚 交換` : "交換しない", true, () => {
      // ⚠️ 最終ラウンドは持ち越せないので、0枚のまま確定フェーズへ進める（詰まないように）。
      if (n === 0 && canCarry) { carry(); return; }   // 交換しない = 持ち越し
      const placed = ui.pokerTargets;
      const picks = [...placed.keys()].sort((a, b) => a - b);
      const targets = picks.map((i) => placed.get(i)!);   // DiscardTarget（自軍/相手）
      m.exchange(user, picks, targets);
      g.applyRoster();                 // 能力値が動いたので派生値（走速など）を作り直す
      ui.pokerTargets = new Map();
      ui.pokerPicked = -1;
      if (user === m.home) { ui.pokerStage = "confirm"; ui.renderPoker(); }
      else cpuHomeDecides(ui, m, g);
    }));
  } else {
    col.appendChild(side("継続", ui.pokerStage === "confirm" && canCarry, carry));
  }

  col.appendChild(side("手札公開", ui.pokerStage === "confirm", () => {
    m.confirm();
    announceHands(m, g);
    g.applyRoster();
    ui.pokerStage = "reveal";
    ui.renderPoker();
  }));
  return col;
}

/** カード欄の**右**。操作モード（カードで強化 ⇄ 選手を入れ替え）のトグル。 */
function pokerModeCol(ui: UI): HTMLDivElement {
  const col = btnCol();
  for (const [mode, label] of [["cards", "カードで強化"], ["swap", "選手を入れ替え"]] as const) {
    const b = document.createElement("button");
    b.textContent = label;
    const act = ui.pokerMode === mode;
    Object.assign(b.style, {
      padding: "4px 12px", borderRadius: "9px", cursor: "pointer",
      fontSize: "11px", fontWeight: act ? "800" : "600",
      background: act ? "rgba(70,120,220,0.92)" : BTN_BG, color: "#fff",
      border: act ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.18)",
      opacity: act ? "1" : "0.7",
    } as Partial<CSSStyleDeclaration>);
    b.onclick = () => { ui.pokerMode = mode; ui.pokerSwapPick = -1; ui.pokerPicked = -1; ui.renderPoker(); };
    col.appendChild(b);
  }
  return col;
}

/**
 * 上段の控え枠に出すチームを選ぶトグル。
 * ⚠️ 相手の控えは以前 `opponentArea` の中（カード欄の下）に並べていたが、
 *    それだと控えの一覧が上下2か所に出て二重になる。同じ位置で切り替える。
 */
function benchSideToggle(ui: UI, user: number, opp: number): HTMLDivElement {
  const col = document.createElement("div");
  // 控え一覧の**左**に縦並びで置く。見出しの文字は置かない（ボタンだけで分かる）。
  Object.assign(col.style, {
    display: "flex", flexDirection: "column", gap: "4px", alignItems: "stretch",
    justifyContent: "center",
  } as Partial<CSSStyleDeclaration>);
  for (const t of [user, opp]) {
    const b = document.createElement("button");
    b.textContent = teamShort(t);
    const act = ui.pokerBenchSide === t;
    Object.assign(b.style, {
      padding: "3px 10px", borderRadius: "8px", cursor: "pointer",
      fontSize: "10px", fontWeight: act ? "800" : "600", whiteSpace: "nowrap",
      background: act ? colorOf(t) : BTN_BG, color: act ? INK : "#fff",
      border: act ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.18)",
      opacity: act ? "1" : "0.7",
    } as Partial<CSSStyleDeclaration>);
    b.onclick = () => { ui.pokerBenchSide = t; ui.pokerSwapPick = -1; ui.renderPoker(); };
    col.appendChild(b);
  }
  return col;
}

/**
 * CPU のチーム編成の手当て。ポーカーの手番のたびに1回だけ走る。
 *  ①役割が「自動」のままの先発へ、攻守のロールを割り当てる
 *  ②控えに明らかに上の選手がいて、その枠に適格なら1人だけ入れ替える
 * ⚠️ 入れ替えは `swapRosterSlots` を通すこと。ポーカーの強化は `applied[].idx` の
 *    インデックス管理なので、直接 ROSTER を触ると別人の能力を巻き戻すことになる。
 * ⚠️ 差が小さいのに入れ替えると毎ラウンド入れ替わって落ち着かないので、明確な差
 *    （SWAP_EDGE）を要求する。1手番につき最大1回。
 */
const SWAP_EDGE = 3;
function cpuAdjustSquad(ui: UI, m: PokerMatch, cpu: number): void {
  // ① 役割: 未設定（＝自動）の先発だけ埋める。手で設定した相手の指定は触らない。
  const takenDef = new Map<string, number>();
  for (let i = 0; i < STARTERS; i++) {
    const d = ROSTER[cpu][i];
    if (d.defRole) takenDef.set(d.defRole, (takenDef.get(d.defRole) ?? 0) + 1);
  }
  for (let i = 0; i < STARTERS; i++) {
    const d = ROSTER[cpu][i];
    if (!d.evalRole) d.evalRole = ui.bestOffRole(d);
    if (!d.defRole) {
      d.defRole = ui.pickDefRole(d, takenDef);
      takenDef.set(d.defRole, (takenDef.get(d.defRole) ?? 0) + 1);
    }
  }

  // ② 入れ替え: 一番弱い先発と、その枠に適格な控えの最良を比べる。
  let worst = -1, worstOvr = Infinity;
  for (let i = 0; i < STARTERS; i++) {
    const v = ui.ovrOf(ROSTER[cpu][i]);
    if (v < worstOvr) { worstOvr = v; worst = i; }
  }
  if (worst < 0) return;
  const slot = SLOT_POS[worst] ?? ROSTER[cpu][worst].role;
  let best = -1, bestOvr = worstOvr + SWAP_EDGE;
  for (let i = STARTERS; i < ROSTER_SIZE; i++) {
    const d = ROSTER[cpu][i];
    if (roleFit(d, slot) <= 0) continue;          // その枠を守れない選手は出さない
    const v = ui.ovrOf(d);
    if (v > bestOvr) { bestOvr = v; best = i; }
  }
  if (best >= 0) swapRosterSlots(ui, m, cpu, worst, best);
}

// ============================================================================
// フォーメーションボード（各チームのベース位置を編集する）
// ============================================================================
// ⚠️ ここで編集するのは「開始位置と戻る先の基準」であって、その瞬間に取る位置ではない。
//    オープンスポットへの動き直し・スペーシング・マーク外しは従来どおり AI が決める。
// ⚠️ 盤はフルコート。**攻撃のベースは攻めるリム側（右端）／守備のベースは守るリム側
//    （左端）**に出る。保持形式 {x, d} が「リムからの距離」なので、攻守が自然に
//    コートの両端へ分かれ、1枚で両方を見渡せる。
//    左端には相手の攻撃ベース、右端には相手の守備ベースが薄く重なる＝マッチアップの絵。

/** コート寸法（config の COURT と一致させること）。盤の % 変換に使う。 */
const BOARD_LEN = 28, BOARD_WID = 15, BOARD_RIM = 13.0;
/** 選手が立てる範囲（コートのクランプと同じ）。 */
const BASE_X_MAX = 7.0;
const BASE_D = { lo: 0.5, hi: 13.5 };

/** ベース位置 → 盤の % 。`atk` = 攻めるリム側（右端）に置くか。 */
function baseToPct(b: { x: number; d: number }, atk: boolean): { x: number; y: number } {
  const z = atk ? BOARD_RIM - b.d : -BOARD_RIM + b.d;
  return {
    x: ((z + BOARD_LEN / 2) / BOARD_LEN) * 100,
    y: ((b.x + BOARD_WID / 2) / BOARD_WID) * 100,
  };
}
/** 盤の % → ベース位置（範囲内へ丸める）。 */
function pctToBase(px: number, py: number, atk: boolean): { x: number; d: number } {
  const z = (px / 100) * BOARD_LEN - BOARD_LEN / 2;
  const d = clampNum(atk ? BOARD_RIM - z : z + BOARD_RIM, BASE_D.lo, BASE_D.hi);
  const x = clampNum((py / 100) * BOARD_WID - BOARD_WID / 2, -BASE_X_MAX, BASE_X_MAX);
  return { x, d };
}
function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** そのチームの攻撃ベース（未設定なら既定値のコピーを作って持たせる）。 */
function offBaseOf(team: number): { x: number; d: number }[] {
  const t = TACTICS[team];
  if (!t.offBase) t.offBase = OFF_BASE_DEFAULT.map((b) => ({ ...b }));
  return t.offBase;
}
function defBaseOf(team: number): { x: number; d: number }[] {
  const t = TACTICS[team];
  if (!t.defBase) t.defBase = DEF_BASE_DEFAULT.map((b) => ({ ...b }));
  return t.defBase;
}

/** 盤に置く小さな顔アイコン（設定ボード用。名前も役割ピルも付けない）。 */
function baseIcon(ui: UI, team: number, idx: number, size: number, dim: boolean): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "absolute", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
    overflow: "hidden", border: `2px solid ${colorOf(team)}`, boxSizing: "border-box",
    background: "rgba(20,24,34,0.9)", transform: "translate(-50%,-50%)",
    opacity: dim ? "0.38" : "1", pointerEvents: dim ? "none" : "auto",
  } as Partial<CSSStyleDeclaration>);
  const pl: Player | undefined = ui.game?.roster[team][idx];
  if (pl) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    Object.assign(c.style, { width: `${size}px`, height: `${size}px`, display: "block" } as Partial<CSSStyleDeclaration>);
    ui.drawFace(c, pl);
    el.appendChild(c);
  }
  return el;
}

/**
 * 1チームぶんの設定ボード。左端＝守備ベース、右端＝攻撃ベース。
 * 相手のベースは薄く重ねるだけで動かせない（`dim`）。
 * 編集できるのは自分のチームだけ（CPU戦の相手やCPU対CPUでは閲覧のみ）。
 */
function formationBoard(ui: UI, team: number, side: "off" | "def"): HTMLDivElement {
  const opp = 1 - team;
  const atk = side === "off";
  const board = document.createElement("div");
  Object.assign(board.style, {
    position: "relative", width: "min(470px, 94vw)", aspectRatio: "28 / 15",
    background: "linear-gradient(180deg, rgba(44,38,30,0.95), rgba(30,26,21,0.95))",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
    flexShrink: "0", margin: "2px 0", touchAction: "none",
  } as Partial<CSSStyleDeclaration>);
  board.innerHTML = COURT_SVG;

  const tag = document.createElement("div");
  tag.textContent = atk ? "攻撃ベース（このリムを攻める）" : "守備ベース（このリムを守る）";
  Object.assign(tag.style, {
    position: "absolute", top: "3px", [atk ? "right" : "left"]: "8px",
    fontSize: "9px", fontWeight: "800", opacity: "0.6", letterSpacing: "1px",
  } as Partial<CSSStyleDeclaration>);
  board.appendChild(tag);

  const editable = POKER_OPTS.userTeam === team;
  const g = ui.game;
  const arr = atk ? offBaseOf(team) : defBaseOf(team);

  for (let i = 0; i < STARTERS; i++) {
    const pl = g?.roster[team][i];
    // 攻撃は「その選手が持ち場にしているスポット」を動かす（ポストのビッグは 5/6）。
    const slot = atk && pl && g ? g.homeSpotIdx(pl) : i;
    if (!arr[slot]) continue;
    // 顔 + そのタブの役割ピルを1つの塊にして盤へ置く。
    // ⚠️ **顔そのものを基準点に置く**。顔と名前をまとめた列を基準にすると、列の幅が
    //    名前の長さで決まり、ピルが「名前の右端」に付いてしまう（＝顔の横ではなくなる）。
    //    名前は顔の下、ピルは顔の右へ、どちらも絶対配置でぶら下げる。
    const d = ROSTER[team][i];
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute", width: "26px", height: "26px",
      transform: "translate(-50%,-50%)",
    } as Partial<CSSStyleDeclaration>);
    const icon = baseIcon(ui, team, i, 26, false);
    icon.style.position = "absolute";
    icon.style.left = "0"; icon.style.top = "0";
    icon.style.transform = "none";
    wrap.appendChild(icon);
    if (d) {
      const nm = document.createElement("div");
      nm.textContent = `${SLOT_POS[i] ?? d.role} ${d.name}`;
      Object.assign(nm.style, {
        position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
        marginTop: "1px", fontSize: "8px", fontWeight: "700", maxWidth: "72px",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        textShadow: "0 1px 3px rgba(0,0,0,0.95)", pointerEvents: "none",
      } as Partial<CSSStyleDeclaration>);
      wrap.appendChild(nm);
      const pills = rolePills(ui, d, team, 30, false, side);
      Object.assign(pills.style, {
        position: "absolute", left: "100%", top: "50%",
        transform: "translateY(-50%)", marginLeft: "3px",
      } as Partial<CSSStyleDeclaration>);
      wrap.appendChild(pills);
    }

    const paint = (): void => {
      const p = baseToPct(arr[slot], atk);
      wrap.style.left = `${p.x}%`; wrap.style.top = `${p.y}%`;
    };
    paint();
    if (editable) {
      // ⚠️ ドラッグの掴み所は**顔だけ**。ピルはタップで役割を変える操作に使う。
      icon.style.cursor = "grab";
      icon.onpointerdown = (ev: PointerEvent) => {
        ev.preventDefault(); ev.stopPropagation();
        icon.setPointerCapture(ev.pointerId);
        icon.style.cursor = "grabbing";
        const move = (e: PointerEvent): void => {
          const r = board.getBoundingClientRect();
          arr[slot] = pctToBase(((e.clientX - r.left) / r.width) * 100,
                                ((e.clientY - r.top) / r.height) * 100, atk);
          paint();
        };
        const up = (): void => {
          icon.style.cursor = "grab";
          icon.removeEventListener("pointermove", move);
          icon.removeEventListener("pointerup", up);
          icon.removeEventListener("pointercancel", up);
        };
        icon.addEventListener("pointermove", move);
        icon.addEventListener("pointerup", up);
        icon.addEventListener("pointercancel", up);
      };
    }
    board.appendChild(wrap);
  }

  // 相手の対になるベースを薄く重ねる（攻撃タブなら相手の守備、守備タブなら相手の攻撃）。
  // ⚠️ 相手の座標は相手のリム基準なので、atk を反転して同じ端へ置く。
  const oArr = atk ? defBaseOf(opp) : offBaseOf(opp);
  for (let i = 0; i < STARTERS; i++) {
    const pl = g?.roster[opp][i];
    const slot = !atk && pl && g ? g.homeSpotIdx(pl) : i;
    const b = oArr[slot]; if (!b) continue;
    const el = baseIcon(ui, opp, i, 20, true);
    const p = baseToPct(b, !atk);
    el.style.left = `${p.x}%`; el.style.top = `${p.y}%`;
    board.appendChild(el);
  }
  return board;
}

/** 盤の切り替え: 試合 / 各チームの設定ボード。 */
function boardToggle(ui: UI, user: number, opp: number): HTMLDivElement {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex", gap: "5px", justifyContent: "center", alignItems: "center",
  } as Partial<CSSStyleDeclaration>);
  void opp;
  // ⚠️ 自チームの攻守を切り替える。役割の編集もここで分担する:
  //    試合 = カード強化と選手交代だけ / 攻撃 = 攻ロールと順位 / 守備 = 守ロール。
  const opts: { key: UI["pokerBoard"]; label: string; col: string }[] = [
    { key: "match", label: "試合", col: "rgba(70,120,220,0.92)" },
    { key: "off", label: "攻撃", col: colorOf(user) },
    { key: "def", label: "守備", col: colorOf(user) },
  ];
  for (const o of opts) {
    const b = document.createElement("button");
    b.textContent = o.label;
    const act = ui.pokerBoard === o.key;
    Object.assign(b.style, {
      padding: "3px 10px", borderRadius: "8px", cursor: "pointer",
      fontSize: "10px", fontWeight: act ? "800" : "600", whiteSpace: "nowrap",
      background: act ? o.col : BTN_BG, color: act ? INK : "#fff",
      border: act ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.18)",
      opacity: act ? "1" : "0.7",
    } as Partial<CSSStyleDeclaration>);
    b.onclick = () => { ui.pokerBoard = o.key; ui.renderPoker(); };
    row.appendChild(b);
  }
  return row;
}

/**
 * 守備タブの追加ピル: ①ゾーン ⇄ マンマーク ②マンマーク時に見る相手。
 * ⚠️ マーク相手は「相手のスロット番号」で持つ。相手が交代しても枠は変わらないので、
 *    誰が入っても同じ枠を見続ける（＝ポジションで見る指示になる）。
 */
function defAssignPills(ui: UI, def: PlayerDef, team: number, small: boolean): HTMLElement[] {
  const on = POKER_OPTS.userTeam !== null && team === POKER_OPTS.userTeam;
  const zone = def.defMode === "zone";
  const out: HTMLElement[] = [];
  out.push(miniPill(zone ? "ゾーン" : "マン", true,
    zone ? "rgb(140,170,255)" : "rgb(255,196,110)",
    "ゾーンディフェンス ⇄ マンマーク", on, small,
    () => {
      def.defMode = zone ? "man" : "zone";
      if (def.defMode === "zone") def.markSlot = undefined;   // ゾーンに相手指定は要らない
      ui.renderPoker();
    }));
  if (!zone) {
    // マーク相手: タップで 自動 → 相手PG → … → 相手C → 自動 と回る。
    const opp = 1 - team;
    const cur = def.markSlot;
    const label = cur === undefined ? "相手: 自動"
      : `相手: ${SLOT_POS[cur] ?? cur} ${(ROSTER[opp][cur]?.name ?? "").slice(0, 4)}`;
    out.push(miniPill(label, cur !== undefined, "rgb(255,196,110)",
      "マンマークで見る相手（自動 = 同じスロットの相手）", on, small,
      () => {
        def.markSlot = cur === undefined ? 0 : cur >= STARTERS - 1 ? undefined : cur + 1;
        ui.renderPoker();
      }));
  }
  return out;
}

/**
 * CPU の守備の割り当て。相手の能力を見て、マンマークの相手・ゾーン・
 * エースへのダブルチームを決める。ポーカーの手番ごとに引き直す。
 *
 * 手順:
 *  ①相手5人の脅威度（得点力 + 身長）と、自分5人の守備力を出す
 *  ②脅威の高い相手から順に、守備力の高い選手を当てる（1対1の組み合わせ）
 *  ③エースが突出していれば、最も脅威の低い相手を見ていた選手をエースへ回す
 *    ＝ダブルチーム。空いた相手は誰も見ないが、それがダブルチームの代償。
 *  ④身長・機動力で明確に劣る組み合わせは、追いかけずゾーンで面を守らせる
 *
 * ⚠️ `markSlot` は**相手のスロット番号**。相手が交代しても枠は変わらない。
 * ⚠️ 手で設定したものは上書きしない（自チームは常にユーザーの指示が優先）。
 */
const ACE_GAP = 0.12;     // エースが2番手をこれだけ上回ればダブルチーム
const ZONE_GAP = 0.18;    // 守備力がこれだけ下回るならゾーンに逃がす
function cpuAssignDefense(cpu: number): void {
  if (POKER_OPTS.userTeam === cpu) return;   // 自チームはユーザーの指示が優先
  const opp = 1 - cpu;
  const threat = (i: number): number => {
    const d = ROSTER[opp][i];
    return d ? scoringPower(d.attr) / 100 + (d.height - 1.9) * 0.25 : 0;
  };
  const guard = (i: number): number => {
    const d = ROSTER[cpu][i];
    if (!d) return 0;
    return rate(d.attr.defense) * 0.55 + rate(d.attr.agility) * 0.25
      + (d.height - 1.9) * 0.4 + rate(d.attr.reaction) * 0.2;
  };

  // ② 脅威の高い順に、守備力の高い選手を当てる
  const oppOrder = [0, 1, 2, 3, 4].sort((a, b) => threat(b) - threat(a));
  const defOrder = [0, 1, 2, 3, 4].sort((a, b) => guard(b) - guard(a));
  const markOf = new Map<number, number>();          // 守備の slot → 相手の slot
  oppOrder.forEach((o, k) => markOf.set(defOrder[k], o));

  // ③ エースが突出していればダブルチーム
  const ace = oppOrder[0], second = oppOrder[1];
  const double = threat(ace) - threat(second) > ACE_GAP;
  if (double) {
    const weakest = oppOrder[oppOrder.length - 1];    // 最も脅威の低い相手
    for (const [dSlot, oSlot] of markOf) {
      if (oSlot === weakest) { markOf.set(dSlot, ace); break; }
    }
  }

  // ④ 反映。明確に劣る組み合わせはゾーンへ逃がす。
  for (let i = 0; i < STARTERS; i++) {
    const d = ROSTER[cpu][i];
    if (!d) continue;
    const o = markOf.get(i);
    if (o === undefined) { d.defMode = undefined; d.markSlot = undefined; continue; }
    if (guard(i) < threat(o) - ZONE_GAP) {
      d.defMode = "zone";                 // 追いかけても振り切られる → 面を守る
      d.markSlot = undefined;
    } else {
      d.defMode = "man";
      d.markSlot = o;
    }
  }
}
