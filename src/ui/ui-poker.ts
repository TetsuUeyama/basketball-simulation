// UI: ポーカー強化の画面。両チーム確定の直後（選手紹介・ティップオフより前）と、
// 各クォーター開始前に挟まる。
//
// 画面は「現在の役」「コートに見立てた盤の上の先発5人」「手札」「ボタン」だけで構成する。
// 手札を選手の上へ置く（ドラッグ、またはカード→選手のタップ）と、その選手が強化される。
// 置いた札＝捨てる札。**1人1枚まで**（同じ選手へ置くと前の札は手札へ戻る）で、
// 1ラウンドに置ける総数は `MAX_DISCARDS` 枚まで。
import { POKER_OPTS } from "../config";
import { ROSTER, ROSTER_SIZE, STARTERS } from "../roster";
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
  { x: 50, y: 74 },   // 0 PG — トップ
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

  // ---- コートに見立てた盤 + 控え ----
  p.appendChild(boardArea(this, m, user));

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

/**
 * ハーフコートの盤（先発5人が立ち位置に並ぶ）と、その横に控え8人。
 * 13人の誰にでも札を置ける。狭い画面では控えが盤の下へ回り込む。
 */
function boardArea(ui: UI, m: PokerMatch, team: number): HTMLDivElement {
  const narrow = window.innerWidth < 660;

  const area = document.createElement("div");
  Object.assign(area.style, {
    display: "flex", gap: "10px", alignItems: "center", justifyContent: "center",
    flexWrap: narrow ? "wrap" : "nowrap", width: "100%",
  } as Partial<CSSStyleDeclaration>);

  const board = document.createElement("div");
  Object.assign(board.style, {
    position: "relative", width: narrow ? "min(330px, 84vw)" : "330px", aspectRatio: "15 / 14",
    background: "linear-gradient(180deg, rgba(44,38,30,0.95), rgba(30,26,21,0.95))",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: "10px",
    flexShrink: "0",
  } as Partial<CSSStyleDeclaration>);
  board.innerHTML = COURT_SVG;
  for (let i = 0; i < STARTERS; i++) {
    const cell = playerCell(ui, m, team, i, 40);
    Object.assign(cell.style, {
      position: "absolute", left: `${SPOT[i].x}%`, top: `${SPOT[i].y}%`,
      transform: "translate(-50%,-50%)",
    } as Partial<CSSStyleDeclaration>);
    board.appendChild(cell);
  }
  area.appendChild(board);

  // コート横のベンチ。広い画面は2列×4段、狭い画面は盤の下に4列×2段。
  const bench = document.createElement("div");
  Object.assign(bench.style, {
    display: "grid", gridTemplateColumns: `repeat(${narrow ? 4 : 2}, auto)`,
    gap: "6px 8px", justifyContent: "center", alignContent: "center",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px", padding: "8px", flexShrink: "0",
  } as Partial<CSSStyleDeclaration>);
  for (let i = STARTERS; i < ROSTER_SIZE; i++) bench.appendChild(playerCell(ui, m, team, i, 32));
  area.appendChild(bench);

  return area;
}

/** 置いた札の1行ぶんの高さ。札が無くても同じ高さを空けておく。 */
const CHIP_H = 13;

/** 札を落とせる選手ひとり分（先発も控えも同じ作り）。 */
function playerCell(ui: UI, m: PokerMatch, team: number, idx: number, size: number): HTMLDivElement {
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
  cell.appendChild(face);

  const def = ROSTER[team][idx];
  const name = document.createElement("div");
  name.textContent = `${def.role} ${def.name}`;
  Object.assign(name.style, {
    fontSize: size >= 40 ? "10px" : "9px", fontWeight: "700",
    maxWidth: size >= 40 ? "94px" : "78px", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 3px rgba(0,0,0,0.9)",
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(name);

  // 置かれた札は名前の下に出す。1人1枚なので必ず1行に収まり、その1行分の高さは
  // 札が無くても**最初から確保しておく**（置いても配置がずれず、控えの行間も詰まらない）。
  const slot = document.createElement("div");
  Object.assign(slot.style, {
    height: `${CHIP_H}px`, marginTop: "1px",
    display: "flex", alignItems: "center", justifyContent: "center",
  } as Partial<CSSStyleDeclaration>);
  cell.appendChild(slot);

  // この選手に置かれている札とその効果（1人1枚）
  for (const [handIdx, target] of ui.pokerTargets) {
    if (target !== idx) continue;
    const card = m.teams[team].hand[handIdx];
    const eff = discardEffect(card, def.attr);
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
    gain.textContent = eff.amount > 0 ? `${ATTR_SHORT.get(eff.key) ?? ""}+${eff.amount}` : "上限";
    gain.style.color = "rgb(120,225,140)";
    chip.append(mark, gain);
    chip.onclick = (e) => {            // 置いた札はタップで手札へ戻す
      e.stopPropagation();
      ui.pokerTargets.delete(handIdx);
      ui.renderPoker();
    };
    slot.appendChild(chip);
  }

  if (ui.pokerStage === "exchange") {
    ui.pokerSpots.push({ idx, el: cell });
    cell.onclick = () => {             // タップ操作: 札を選んでから選手を叩く
      if (ui.pokerPicked < 0) return;
      placeCard(ui, ui.pokerPicked, idx);
      ui.pokerPicked = -1;
      ui.renderPoker();
    };
  }
  return cell;
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

/**
 * 札を選手へ置く（＝捨てて強化する予約）。**1人1枚**なので、既にその選手へ置いてある
 * 札は手札へ戻して置き換える。全体の枚数上限に達していたら何もしない。
 */
function placeCard(ui: UI, handIdx: number, target: number): void {
  for (const [other, t] of ui.pokerTargets) {
    if (t === target && other !== handIdx) ui.pokerTargets.delete(other);
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

  const hit = (x: number, y: number): { idx: number; el: HTMLElement } | null => {
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
