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
import { PokerMatch, POKER_ROUNDS, type DiscardTarget } from "../poker/state";
import { SUIT_MARK, SUIT_RED, rankLabel, type Card } from "../poker/cards";
import { discardEffect, hinderEffect, MAX_DISCARDS } from "../poker/effects";
import { cpuExchange, cpuWantsConfirm } from "../poker/ai";
import { UI, colorOf, INK } from "./ui";

declare module "./ui" {
  interface UI {
    pokerPanel?: HTMLDivElement;
    pokerStage?: "exchange" | "confirm" | "reveal";
    /** 手札の添字 → 置いた先（自軍なら強化 / 相手なら妨害）。置く＝捨てる。 */
    pokerTargets: Map<number, DiscardTarget>;
    /** タップ操作で選択中の手札（ドラッグしない環境用）。-1 = なし */
    pokerPicked: number;
    /** 札を置ける選手アイコン（ドロップ判定に使う）。 */
    pokerSpots: { target: DiscardTarget; el: HTMLElement }[];
    /** ラウンド1が終わったあとに一度だけ走らせる処理（選手紹介 → ティップオフ）。 */
    pokerThen: (() => void) | null;
    beginPoker(then?: () => void): void;
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

  // ---- 相手の伏せた手札（最上段） ----
  p.appendChild(opponentArea(this, m, opp));

  // ---- コート盤: 左半分が相手の先発5人（妨害）/ 右半分が自分の先発5人（強化） ----
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

  // ---- 控え8人（手札の下） ----
  p.appendChild(benchGrid(this, m, user));

  // ---- 現在の役 + ボタン ----
  const btns = document.createElement("div");
  Object.assign(btns.style, {
    display: "flex", gap: "12px", justifyContent: "center", alignItems: "center", flexWrap: "wrap",
  } as Partial<CSSStyleDeclaration>);
  const rank = m.peek(user);
  const rankRow = document.createElement("div");
  Object.assign(rankRow.style, {
    display: "flex", alignItems: "baseline", gap: "8px",
    fontSize: "clamp(14px,3.4vw,19px)", fontWeight: "800", letterSpacing: "1px",
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
  btns.appendChild(rankRow);
  const accent = (b: HTMLButtonElement): void => {
    Object.assign(b.style, { background: colorOf(user), color: INK, fontWeight: "800" } as Partial<CSSStyleDeclaration>);
  };

  if (this.pokerStage === "exchange") {
    const n = placed.size;
    const ex = this.button(n ? `${n}枚 交換` : "交換しない");
    if (n) accent(ex);
    ex.onclick = () => {
      const picks = [...placed.keys()].sort((a, b) => a - b);
      const targets = picks.map((i) => placed.get(i)!);   // DiscardTarget（自軍/相手）
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
  for (const c of m.teams[opp].hand) {
    hand.appendChild(revealed ? cardFace(c, 30, 42) : cardBack(30, 42, opp));
  }
  area.appendChild(hand);

  // 相手の控え8人。ここにも札を置いて妨害できる（自分側と対称の並び）。
  area.appendChild(benchGrid(ui, m, opp));

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
    flexShrink: "0", margin: "2px 0 14px",
  } as Partial<CSSStyleDeclaration>);
  board.innerHTML = COURT_SVG;
  const put = (t: number, i: number, spot: { x: number; y: number }): void => {
    const cell = playerCell(ui, m, t, i, 34);
    Object.assign(cell.style, {
      position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`,
      transform: "translate(-50%,-50%)",
    } as Partial<CSSStyleDeclaration>);
    board.appendChild(cell);
  };
  for (let i = 0; i < STARTERS; i++) put(opp, i, OPP_SPOT[i]);   // 相手は左半分
  for (let i = 0; i < STARTERS; i++) put(team, i, OWN_SPOT[i]);  // 自分は右半分
  return board;
}

/** 控え8人。手札の下に4列×2段で並べる。 */
function benchGrid(ui: UI, m: PokerMatch, team: number): HTMLDivElement {
  const bench = document.createElement("div");
  Object.assign(bench.style, {
    display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: "4px 10px",
    justifyContent: "center", alignContent: "center",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px", padding: "6px 8px",
  } as Partial<CSSStyleDeclaration>);
  for (let i = STARTERS; i < ROSTER_SIZE; i++) bench.appendChild(playerCell(ui, m, team, i, 30));
  return bench;
}

/** 置いた札の1行ぶんの高さ。札が無くても同じ高さを空けておく。 */
const CHIP_H = 13;

/**
 * 札を落とせる選手ひとり分（先発・控え・相手選手すべて同じ作り）。
 * `team` が操作中のチームなら強化、相手チームなら妨害になる。
 */
function playerCell(ui: UI, m: PokerMatch, team: number, idx: number, size: number): HTMLDivElement {
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
    slot.appendChild(chip);
  }

  if (ui.pokerStage === "exchange") {
    const target: DiscardTarget = { team, idx };
    ui.pokerSpots.push({ target, el: cell });
    cell.onclick = () => {             // タップ操作: 札を選んでから選手を叩く
      if (ui.pokerPicked < 0) return;
      placeCard(ui, ui.pokerPicked, target);
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
