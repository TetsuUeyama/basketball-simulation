// UI: ポーカー強化の画面。両チーム確定の直後（選手紹介・ティップオフより前）と、
// 各クォーター開始前に挟まる。
//
// 画面は「現在の役」「コートに見立てた盤の上の先発5人」「手札」「ボタン」だけで構成する。
// 手札を選手の上へ置く（ドラッグ、またはカード→選手のタップ）と、その選手が強化される。
// 置いた札＝捨てる札なので、置ける枚数は 1ラウンド `MAX_DISCARDS` 枚まで。
import { POKER_OPTS } from "../config";
import { ROSTER, STARTERS } from "../roster";
import { ATTR_META } from "../attributes";
import type { Player } from "../objects/player/player";
import { PokerMatch, POKER_ROUNDS } from "../poker/state";
import { SUIT_MARK, SUIT_RED, rankLabel, type Card } from "../poker/cards";
import { discardEffect, MAX_DISCARDS } from "../poker/effects";
import { cpuExchange, cpuWantsConfirm } from "../poker/ai";
import { UI, colorOf, INK } from "./ui";

declare module "./ui" {
  interface UI {
    pokerPanel?: HTMLDivElement;
    pokerStage?: "exchange" | "confirm" | "reveal";
    /** 手札の添字 → 置いた先のロスター番号。置く＝捨てる。 */
    pokerTargets: Map<number, number>;
    /** タップ操作で選択中の手札（ドラッグしない環境用）。-1 = なし */
    pokerPicked: number;
    /** 盤上の選手アイコン（ドロップ判定に使う）。 */
    pokerSpots: { idx: number; el: HTMLElement }[];
    /** ラウンド1が終わったあとに一度だけ走らせる処理（選手紹介 → ティップオフ）。 */
    pokerThen: (() => void) | null;
    beginPoker(then?: () => void): void;
    openPoker(round: number): void;
    renderPoker(): void;
    finishPokerRound(): void;
  }
}

const ATTR_SHORT = new Map(ATTR_META.map((m) => [m.key, m.label]));

/** 盤上の立ち位置（%）。上がゴール側。 */
const SPOT: { x: number; y: number }[] = [
  { x: 50, y: 79 },   // 0 PG — トップ
  { x: 85, y: 56 },   // 1 SG — 右ウイング
  { x: 15, y: 56 },   // 2 SF — 左ウイング
  { x: 31, y: 29 },   // 3 PF — 左ローポスト
  { x: 63, y: 25 },   // 4 C  — ゴール下
];

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

  // 相手（CPU）の交換を先に済ませる。CPU 同士なら両方ここで打つ。
  for (const t of [0, 1]) if (t !== user) cpuExchange(m, t, ROSTER);

  if (user === null) {
    if (cpuWantsConfirm(m)) { m.confirm(); announceHands(m, g); }
    else m.carryOver();
    g.applyRoster();
    this.finishPokerRound();
    return;
  }

  this.simPaused = true;
  this.pokerTargets = new Map();
  this.pokerPicked = -1;
  this.pokerSpots = [];
  this.pokerStage = m.canExchange(user) ? "exchange" : "confirm";
  if (!this.pokerPanel) {
    const p = this.panel();
    Object.assign(p.style, { zIndex: "70", gap: "10px", padding: "12px" } as Partial<CSSStyleDeclaration>);
    this.pokerPanel = p;
    this.root.appendChild(p);
  }
  this.pokerPanel.style.display = "flex";
  this.renderPoker();
  void round;
};

UI.prototype.renderPoker = function(): void {
  const g = this.game;
  const m = g?.poker;
  const p = this.pokerPanel;
  const user = POKER_OPTS.userTeam;
  if (!g || !m || !p || user === null) return;
  p.replaceChildren();
  this.pokerSpots = [];

  const opp = 1 - user;
  const placed = this.pokerTargets;

  // ---- 現在の役 ----
  const rank = m.peek(user);
  const rankRow = document.createElement("div");
  Object.assign(rankRow.style, {
    display: "flex", alignItems: "baseline", gap: "10px", justifyContent: "center",
    fontSize: "clamp(15px,3.8vw,21px)", fontWeight: "800", letterSpacing: "1px",
    color: colorOf(user),
  } as Partial<CSSStyleDeclaration>);
  const mine = document.createElement("span");
  mine.textContent = rank.name;
  rankRow.appendChild(mine);
  const oppRank = m.teams[opp].rank;
  if (oppRank) {
    const vs = document.createElement("span");
    vs.textContent = "vs";
    Object.assign(vs.style, { fontSize: "12px", opacity: "0.6", color: "#fff", fontWeight: "600" });
    const theirs = document.createElement("span");
    theirs.textContent = oppRank.name;
    Object.assign(theirs.style, { color: colorOf(opp) });
    rankRow.append(vs, theirs);
  }
  p.appendChild(rankRow);

  // ---- コートに見立てた盤 ----
  p.appendChild(courtBoard(this, m, user));

  // ---- 手札（置いていない札だけ）----
  const handRow = document.createElement("div");
  Object.assign(handRow.style, {
    display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", minHeight: "76px",
  } as Partial<CSSStyleDeclaration>);
  const hand = m.teams[user].hand;
  hand.forEach((card, i) => {
    if (placed.has(i)) return;
    handRow.appendChild(handCard(this, card, i));
  });
  p.appendChild(handRow);

  // ---- ボタン ----
  const btns = document.createElement("div");
  Object.assign(btns.style, { display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" });
  const accent = (b: HTMLButtonElement): void => {
    Object.assign(b.style, { background: colorOf(user), color: INK, fontWeight: "800" } as Partial<CSSStyleDeclaration>);
  };

  if (this.pokerStage === "exchange") {
    const n = placed.size;
    const ex = this.button(n ? `${n}枚 交換` : "交換しない");
    if (n) accent(ex);
    ex.onclick = () => {
      const picks = [...placed.keys()].sort((a, b) => a - b);
      const targets = picks.map((i) => placed.get(i)!);
      m.exchange(user, picks, targets);
      g.applyRoster();                 // 能力値が動いたので派生値（走速など）を作り直す
      this.pokerTargets = new Map();
      this.pokerPicked = -1;
      if (user === m.home) { this.pokerStage = "confirm"; this.renderPoker(); }
      else cpuHomeDecides(this, m, g);
    };
    btns.appendChild(ex);
  } else if (this.pokerStage === "confirm") {
    const lock = this.button("確定");
    accent(lock);
    lock.onclick = () => {
      m.confirm();
      announceHands(m, g);
      g.applyRoster();
      this.pokerStage = "reveal";
      this.renderPoker();
    };
    btns.appendChild(lock);
    if (m.round < POKER_ROUNDS) {
      const carry = this.button("持ち越し");
      carry.onclick = () => { m.carryOver(); this.finishPokerRound(); };
      btns.appendChild(carry);
    }
  } else {
    const go = this.button("試合へ");
    accent(go);
    go.onclick = () => this.finishPokerRound();
    btns.appendChild(go);
  }
  p.appendChild(btns);

  // 確定後は相手の手札も見せる
  if (this.pokerStage === "reveal") {
    const oppHand = document.createElement("div");
    Object.assign(oppHand.style, { display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" });
    for (const c of m.teams[opp].hand) oppHand.appendChild(cardFace(c, 32, 45));
    p.appendChild(oppHand);
  }
};

/** ラウンドを閉じて試合へ戻す。 */
UI.prototype.finishPokerRound = function(): void {
  if (this.pokerPanel) this.pokerPanel.style.display = "none";
  this.simPaused = false;
  this.game?.applyRoster();
  this.game?.resumeFromPoker();
  const then = this.pokerThen;
  this.pokerThen = null;
  if (then) then();          // ラウンド1のあとだけ: 選手紹介 → ティップオフ
};

// ---- 部品 -----------------------------------------------------------------

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

/** ハーフコートの盤。上がゴール側で、先発5人が立ち位置に並ぶ。 */
function courtBoard(ui: UI, m: PokerMatch, team: number): HTMLDivElement {
  const board = document.createElement("div");
  Object.assign(board.style, {
    position: "relative", width: "min(430px, 88vw)", aspectRatio: "15 / 14",
    background: "linear-gradient(180deg, rgba(44,38,30,0.95), rgba(30,26,21,0.95))",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px", overflow: "hidden",
    flexShrink: "0",
  } as Partial<CSSStyleDeclaration>);
  board.innerHTML = COURT_SVG;

  const players: Player[] = ui.game ? ui.game.roster[team] : [];
  for (let i = 0; i < STARTERS; i++) {
    const spot = SPOT[i];
    const cell = document.createElement("div");
    Object.assign(cell.style, {
      position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`, transform: "translate(-50%,-50%)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
      pointerEvents: "auto", cursor: "pointer",
    } as Partial<CSSStyleDeclaration>);

    const face = document.createElement("div");
    Object.assign(face.style, {
      position: "relative", width: "44px", height: "44px", borderRadius: "50%", overflow: "hidden",
      border: `2px solid ${colorOf(team)}`, boxShadow: "0 2px 8px rgba(0,0,0,0.55)",
      background: "rgba(20,24,34,0.9)",
    } as Partial<CSSStyleDeclaration>);
    const pl = players[i];
    if (pl) {
      const canvas = document.createElement("canvas");
      canvas.width = 44; canvas.height = 44;
      Object.assign(canvas.style, { width: "44px", height: "44px", display: "block" } as Partial<CSSStyleDeclaration>);
      ui.drawFace(canvas, pl);
      face.appendChild(canvas);
    }
    cell.appendChild(face);

    const name = document.createElement("div");
    name.textContent = `${ROSTER[team][i].role} ${ROSTER[team][i].name}`;
    Object.assign(name.style, {
      fontSize: "10px", fontWeight: "700", maxWidth: "94px", whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 3px rgba(0,0,0,0.9)",
    } as Partial<CSSStyleDeclaration>);
    cell.appendChild(name);

    // この選手に置かれている札とその効果
    for (const [handIdx, target] of ui.pokerTargets) {
      if (target !== i) continue;
      const card = m.teams[team].hand[handIdx];
      const eff = discardEffect(card, ROSTER[team][i].attr);
      const chip = document.createElement("div");
      Object.assign(chip.style, {
        display: "flex", alignItems: "center", gap: "4px", pointerEvents: "auto",
        background: "rgba(12,15,22,0.92)", border: "1px solid rgba(255,255,255,0.3)",
        borderRadius: "7px", padding: "1px 5px", fontSize: "10px", fontWeight: "800",
      } as Partial<CSSStyleDeclaration>);
      const mark = document.createElement("span");
      mark.textContent = `${SUIT_MARK[card.suit]}${rankLabel(card.rank)}`;
      mark.style.color = SUIT_RED[card.suit] ? "#ff6b72" : "#e6e9f0";
      const gain = document.createElement("span");
      gain.textContent = eff.amount > 0 ? `${ATTR_SHORT.get(eff.key) ?? ""}+${eff.amount}` : "上限";
      gain.style.color = "rgb(120,225,140)";
      chip.append(mark, gain);
      chip.onclick = (e) => {            // 置いた札はタップで手札へ戻す
        e.stopPropagation();
        ui.pokerTargets.delete(handIdx);
        ui.renderPoker();
      };
      cell.appendChild(chip);
    }

    if (ui.pokerStage === "exchange") {
      ui.pokerSpots.push({ idx: i, el: cell });
      cell.onclick = () => {             // タップ操作: 札を選んでから選手を叩く
        if (ui.pokerPicked < 0) return;
        placeCard(ui, ui.pokerPicked, i);
        ui.pokerPicked = -1;
        ui.renderPoker();
      };
    }
    board.appendChild(cell);
  }
  return board;
}

/** 手札の1枚。ドラッグして選手へ落とす / タップで選んでから選手を叩く。 */
function handCard(ui: UI, card: Card, i: number): HTMLDivElement {
  const el = cardFace(card, 52, 74);
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

/** 札を選手へ置く（＝捨てて強化する予約）。上限に達していたら何もしない。 */
function placeCard(ui: UI, handIdx: number, target: number): void {
  if (!ui.pokerTargets.has(handIdx) && ui.pokerTargets.size >= MAX_DISCARDS) return;
  ui.pokerTargets.set(handIdx, target);
}

/** カードのドラッグ。指/カーソルに追従する影を出し、離した位置の選手へ置く。 */
function beginCardDrag(ui: UI, card: Card, i: number, ev: PointerEvent): void {
  if (ev.button !== undefined && ev.button !== 0) return;
  const ghost = cardFace(card, 52, 74);
  Object.assign(ghost.style, {
    position: "fixed", zIndex: "95", pointerEvents: "none", opacity: "0.92",
    transform: "translate(-50%,-50%) rotate(-4deg)",
  } as Partial<CSSStyleDeclaration>);
  ghost.style.left = `${ev.clientX}px`;
  ghost.style.top = `${ev.clientY}px`;
  document.body.appendChild(ghost);
  let moved = false;
  let hot: HTMLElement | null = null;

  const hit = (x: number, y: number): { idx: number; el: HTMLElement } | null => {
    for (const s of ui.pokerSpots) {
      const r = s.el.getBoundingClientRect();
      // 落としやすいように判定を少し広く取る
      if (x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12) return s;
    }
    return null;
  };
  const move = (e: PointerEvent): void => {
    moved = true;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    const s = hit(e.clientX, e.clientY);
    if (hot && hot !== s?.el) hot.style.filter = "";
    hot = s ? s.el : null;
    if (hot) hot.style.filter = "brightness(1.35)";
  };
  const cleanup = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointercancel", cancel);
    ghost.remove();
    if (hot) hot.style.filter = "";
  };
  const cancel = (): void => { cleanup(); ui.renderPoker(); };
  const up = (e: PointerEvent): void => {
    const s = hit(e.clientX, e.clientY);
    cleanup();
    if (s) {
      placeCard(ui, i, s.idx);
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

// ハーフコートのライン（15m×14m を 150×140 で描く。上がゴール側）。
const COURT_SVG = `
<svg viewBox="0 0 150 140" preserveAspectRatio="none"
     style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
  <g fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="1.2">
    <rect x="2" y="2" width="146" height="136"/>
    <rect x="50.5" y="2" width="49" height="56"/>
    <circle cx="75" cy="58" r="18"/>
    <circle cx="75" cy="13" r="4.5"/>
    <line x1="66" y1="6" x2="84" y2="6"/>
    <path d="M 8,2 L 8,32 A 70 70 0 0 0 142,32 L 142,2"/>
    <line x1="2" y1="138" x2="148" y2="138" stroke-width="2"/>
  </g>
</svg>`;
