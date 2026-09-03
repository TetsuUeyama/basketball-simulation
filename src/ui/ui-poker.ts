// UI: ポーカー強化の画面。試合開始前と各クォーター開始前に挟まる。
//
// 1ラウンドの流れ:
//   CPU チームの交換を先に済ませる → ユーザーが「捨てる札」と「強化を受ける選手」を選ぶ
//   → ホームが「役を確定する / 持ち越す」を選ぶ → 確定なら両チームの手を公開して強化を乗せる
// ユーザー操作が無い設定（POKER_OPTS.userTeam = null）では画面を出さず、CPU 同士で自動進行する。
import { POKER_OPTS, teamAbbr } from "../config";
import { ROSTER, STARTERS } from "../roster";
import { ATTR_META } from "../attributes";
import { PokerMatch, POKER_ROUNDS } from "../poker/state";
import { SUIT_MARK, SUIT_RED, rankLabel, type Card } from "../poker/cards";
import { discardEffect, handSummary, MAX_DISCARDS } from "../poker/effects";
import { cpuExchange, cpuWantsConfirm, pickTarget } from "../poker/ai";
import { UI, colorOf, BTN_BG, INK } from "./ui";

declare module "./ui" {
  interface UI {
    pokerPanel?: HTMLDivElement;
    pokerStage?: "exchange" | "confirm" | "reveal";
    pokerSel: number[];                    // 選択中（＝捨てる）手札の添字
    pokerTargets: Map<number, number>;     // 手札の添字 → 強化を受けるロスター番号
    beginPoker(seed?: number): void;
    pokerModeButton(): HTMLButtonElement;
    openPoker(round: number): void;
    renderPoker(): void;
    finishPokerRound(): void;
  }
}

const ATTR_NAME = new Map(ATTR_META.map((m) => [m.key, m.name]));

/** 試合前バーの「ポーカー: 自分で打つ ⇄ CPU同士」トグル。 */
UI.prototype.pokerModeButton = function(): HTMLButtonElement {
  const b = this.button("");
  Object.assign(b.style, {
    fontSize: "12px", padding: "8px 14px", justifySelf: "start", marginLeft: "14px",
  } as Partial<CSSStyleDeclaration>);
  const label = (): void => {
    b.textContent = POKER_OPTS.userTeam === null
      ? "ポーカー: CPU同士"
      : "ポーカー: 自分で打つ（" + teamAbbr(POKER_OPTS.userTeam) + "）";
  };
  b.onclick = () => {
    POKER_OPTS.userTeam = POKER_OPTS.userTeam === null ? POKER_OPTS.home : null;
    label();
  };
  label();
  return b;
};

/** 試合の頭で新しいポーカーを始める（TIP OFF から呼ばれる）。 */
UI.prototype.beginPoker = function(seed?: number): void {
  const g = this.game;
  if (!g) return;
  g.poker?.revert();          // 前の試合の強化を能力値から抜く
  g.poker = new PokerMatch(ROSTER, POKER_OPTS.home, seed ?? (Date.now() >>> 0));
  g.onPokerRound = (round) => this.openPoker(round);
  g.applyRoster();
  this.openPoker(1);          // ラウンド1（試合開始前）
};

/** そのラウンドを開く。ユーザーが打たない場合はここで自動解決する。 */
UI.prototype.openPoker = function(round: number): void {
  const g = this.game;
  const m = g?.poker;
  if (!g || !m || !m.active) { this.finishPokerRound(); return; }
  const user = POKER_OPTS.userTeam;

  // 相手（CPU）の交換を先に済ませる。CPU 同士なら両方ここで打つ。
  for (const t of [0, 1]) if (t !== user) cpuExchange(m, t, ROSTER);

  if (user === null) {
    // 観戦モード: ホーム CPU が確定タイミングを決める
    if (cpuWantsConfirm(m)) { m.confirm(); announceHands(m, g); }
    else m.carryOver();
    g.applyRoster();
    this.finishPokerRound();
    return;
  }

  this.simPaused = true;
  this.pokerSel = [];
  this.pokerTargets = new Map();
  this.pokerStage = m.canExchange(user) ? "exchange" : "confirm";
  if (!this.pokerPanel) {
    const p = this.panel();
    Object.assign(p.style, { zIndex: "70", width: "min(720px, 96vw)", gap: "12px" } as Partial<CSSStyleDeclaration>);
    this.pokerPanel = p;
    this.root.appendChild(p);
  }
  this.pokerPanel.style.display = "flex";
  this.renderPoker();
  void round;   // 表示するラウンドは match 側が持っている
};

UI.prototype.renderPoker = function(): void {
  const g = this.game;
  const m = g?.poker;
  const p = this.pokerPanel;
  const user = POKER_OPTS.userTeam;
  if (!g || !m || !p || user === null) return;
  p.replaceChildren();

  const isHome = user === m.home;
  const opp = 1 - user;

  // ---- 見出し ----
  const head = document.createElement("div");
  Object.assign(head.style, { display: "flex", flexDirection: "column", gap: "2px", alignItems: "center" });
  const title = document.createElement("div");
  title.textContent = m.round === 1 ? "ポーカー — 試合開始前" : `ポーカー — 第${m.round}クォーター開始前`;
  Object.assign(title.style, { fontSize: "clamp(15px,3.6vw,20px)", fontWeight: "800", letterSpacing: "1px" });
  const sub = document.createElement("div");
  sub.textContent = m.round >= POKER_ROUNDS
    ? "最終ラウンド — このラウンドで役が確定する"
    : `交換はこのラウンドで1回 / 残り ${POKER_ROUNDS - m.round} ラウンド持ち越せる`;
  Object.assign(sub.style, { fontSize: "12px", opacity: "0.72" });
  head.append(title, sub);
  p.appendChild(head);

  // ---- 相手の状況 ----
  const oppRow = document.createElement("div");
  Object.assign(oppRow.style, {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
    fontSize: "12px", opacity: "0.8",
  });
  const oppRank = m.teams[opp].rank;
  oppRow.textContent = oppRank
    ? `${teamAbbr(opp)}: ${oppRank.name}（${handSummary(oppRank)}）`
    : `${teamAbbr(opp)}: 伏せ札 5枚 — 交換 ${m.teams[opp].exchanges} 回`;
  p.appendChild(oppRow);

  // ---- 自分の手札 ----
  const handRow = document.createElement("div");
  Object.assign(handRow.style, { display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" });
  const hand = m.teams[user].hand;
  hand.forEach((card, i) => handRow.appendChild(cardEl(card, this, i)));
  p.appendChild(handRow);

  // ---- 現在の役 ----
  const rank = m.peek(user);
  const rankRow = document.createElement("div");
  rankRow.textContent = m.teams[user].locked
    ? `確定した役: ${rank.name} → ${handSummary(rank)}`
    : `いまの役: ${rank.name}（確定すれば ${handSummary(rank)}）`;
  Object.assign(rankRow.style, {
    fontSize: "clamp(13px,3vw,15px)", fontWeight: "700", color: colorOf(user),
  });
  p.appendChild(rankRow);

  // ---- 捨てる札の宛先 ----
  if (this.pokerStage === "exchange" && this.pokerSel.length) {
    const box = document.createElement("div");
    Object.assign(box.style, {
      display: "flex", flexDirection: "column", gap: "6px", width: "100%",
      background: "rgba(255,255,255,0.04)", borderRadius: "10px", padding: "8px 10px", boxSizing: "border-box",
    } as Partial<CSSStyleDeclaration>);
    const cap = document.createElement("div");
    cap.textContent = "捨てる札の強化を受け取る選手（先発5人から）";
    Object.assign(cap.style, { fontSize: "11px", opacity: "0.7" });
    box.appendChild(cap);
    for (const i of this.pokerSel.slice().sort((a, b) => a - b)) {
      box.appendChild(targetRow(this, m, user, i));
    }
    p.appendChild(box);
  }

  // ---- ログ ----
  const log = m.teams[user].log.slice(-4);
  if (log.length) {
    const logBox = document.createElement("div");
    Object.assign(logBox.style, { fontSize: "11.5px", opacity: "0.78", lineHeight: "1.55", textAlign: "left", width: "100%" });
    for (const line of log) {
      const d = document.createElement("div");
      d.textContent = `・${line}`;
      logBox.appendChild(d);
    }
    p.appendChild(logBox);
  }

  // ---- ボタン ----
  const btns = document.createElement("div");
  Object.assign(btns.style, { display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" });

  if (this.pokerStage === "exchange") {
    const ex = this.button(this.pokerSel.length ? `${this.pokerSel.length}枚 交換する` : "交換しない");
    ex.onclick = () => {
      const picks = this.pokerSel.slice().sort((a, b) => a - b);
      const targets = picks.map((i) => this.pokerTargets.get(i) ?? pickTarget(hand[i], ROSTER[user]));
      m.exchange(user, picks, targets);
      g.applyRoster();                 // 能力値が動いたので派生値（走速など）を作り直す
      this.pokerSel = [];
      this.pokerTargets = new Map();
      if (isHome) { this.pokerStage = "confirm"; this.renderPoker(); }
      else { cpuHomeDecides(this, m, g); }
    };
    btns.appendChild(ex);
    const hint = document.createElement("div");
    hint.textContent = `捨てられるのは1回に ${MAX_DISCARDS} 枚まで`;
    Object.assign(hint.style, { fontSize: "11px", opacity: "0.6", width: "100%" });
    btns.appendChild(hint);
  } else if (this.pokerStage === "confirm") {
    const last = m.round >= POKER_ROUNDS;
    const lock = this.button(last ? "役を確定する（最終）" : "役を確定する");
    Object.assign(lock.style, { background: colorOf(user), color: INK, fontWeight: "800" } as Partial<CSSStyleDeclaration>);
    lock.onclick = () => {
      m.confirm();
      announceHands(m, g);
      g.applyRoster();
      this.pokerStage = "reveal";
      this.renderPoker();
    };
    btns.appendChild(lock);
    if (!last) {
      const carry = this.button("持ち越す");
      Object.assign(carry.style, { background: BTN_BG } as Partial<CSSStyleDeclaration>);
      carry.onclick = () => { m.carryOver(); this.finishPokerRound(); };
      btns.appendChild(carry);
    }
    const note = document.createElement("div");
    note.textContent = isHome
      ? "確定のタイミングはホームチームの権利。早く確定するほど長く効き、引っ張るほど強い役を狙える。"
      : "確定のタイミングは相手（ホーム）が決める。";
    Object.assign(note.style, { fontSize: "11px", opacity: "0.62", width: "100%", lineHeight: "1.5" });
    btns.appendChild(note);
  } else {
    const go = this.button("試合へ");
    Object.assign(go.style, { background: colorOf(user), color: INK, fontWeight: "800" } as Partial<CSSStyleDeclaration>);
    go.onclick = () => this.finishPokerRound();
    btns.appendChild(go);
  }
  p.appendChild(btns);

  // 確定後は相手の手も見せる
  if (this.pokerStage === "reveal") {
    const oppHand = document.createElement("div");
    Object.assign(oppHand.style, { display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap", marginTop: "2px" });
    for (const c of m.teams[opp].hand) oppHand.appendChild(cardFace(c, 34, 48));
    p.appendChild(oppHand);
  }
};

/** ラウンドを閉じて試合へ戻す。 */
UI.prototype.finishPokerRound = function(): void {
  if (this.pokerPanel) this.pokerPanel.style.display = "none";
  this.simPaused = false;
  this.game?.resumeFromPoker();
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
    g.applyRoster();
    ui.pokerStage = "reveal";
    ui.renderPoker();
  } else {
    m.carryOver();
    ui.finishPokerRound();
  }
}

/** クリックで選べる手札の1枚。 */
function cardEl(card: Card, ui: UI, i: number): HTMLDivElement {
  const el = cardFace(card, 52, 74);
  const selected = ui.pokerSel.includes(i);
  const locked = ui.pokerStage !== "exchange";
  if (selected) {
    Object.assign(el.style, {
      transform: "translateY(-6px)", outline: "3px solid rgba(255,90,80,0.95)", opacity: "0.85",
    } as Partial<CSSStyleDeclaration>);
    const tag = document.createElement("div");
    tag.textContent = "捨";
    Object.assign(tag.style, {
      position: "absolute", top: "-9px", right: "-6px", background: "rgb(220,70,60)", color: "#fff",
      fontSize: "10px", fontWeight: "800", borderRadius: "6px", padding: "1px 4px",
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(tag);
  }
  if (!locked) {
    el.style.cursor = "pointer";
    el.style.pointerEvents = "auto";
    el.onclick = () => {
      const at = ui.pokerSel.indexOf(i);
      if (at >= 0) { ui.pokerSel.splice(at, 1); ui.pokerTargets.delete(i); }
      else if (ui.pokerSel.length < MAX_DISCARDS) ui.pokerSel.push(i);
      ui.renderPoker();
    };
  }
  return el;
}

/** 札の見た目だけ（相手の公開手札にも使う）。 */
function cardFace(card: Card, w: number, h: number): HTMLDivElement {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "relative", width: `${w}px`, height: `${h}px`, borderRadius: "8px",
    background: "#f3f5f9", color: SUIT_RED[card.suit] ? "#c8202a" : "#15181f",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    fontWeight: "800", boxShadow: "0 3px 10px rgba(0,0,0,0.45)", transition: "transform 0.12s",
    lineHeight: "1.05", flexShrink: "0",
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

/** 捨てる1枚について「誰に付けるか」を選ぶ行。 */
function targetRow(ui: UI, m: PokerMatch, team: number, i: number): HTMLDivElement {
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px", pointerEvents: "auto" });
  const card = m.teams[team].hand[i];

  const chip = document.createElement("span");
  chip.textContent = `${SUIT_MARK[card.suit]}${rankLabel(card.rank)}`;
  Object.assign(chip.style, {
    background: "#f3f5f9", color: SUIT_RED[card.suit] ? "#c8202a" : "#15181f",
    borderRadius: "6px", padding: "2px 7px", fontWeight: "800", fontSize: "13px", flexShrink: "0",
  } as Partial<CSSStyleDeclaration>);

  const sel = document.createElement("select");
  Object.assign(sel.style, {
    background: BTN_BG, color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "8px", padding: "4px 6px", fontSize: "12px", flex: "1", minWidth: "0",
  } as Partial<CSSStyleDeclaration>);
  const cur = ui.pokerTargets.get(i) ?? pickTarget(card, ROSTER[team]);
  ui.pokerTargets.set(i, cur);
  for (let k = 0; k < STARTERS; k++) {
    const def = ROSTER[team][k];
    const eff = discardEffect(card, def.attr);
    const o = document.createElement("option");
    o.value = String(k);
    o.textContent = `${def.role} ${def.name} — ${ATTR_NAME.get(eff.key) ?? eff.key} ${eff.amount > 0 ? `+${eff.amount}` : "上限"}`;
    if (k === cur) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => { ui.pokerTargets.set(i, Number(sel.value)); ui.renderPoker(); };

  row.append(chip, sel);
  return row;
}
