// CPU 同士（観戦）のポーカー進行を、UI と同じ順番で回して中身を確かめる。
// ⚠️ UI は DOM が要るのでここでは動かせない。UI がやる手順（アウェイ→ホーム→ホームが確定判断）を
//    そのまま写して、状態機械の側が正しいかを見る。
import "./stubs";
import { ROSTER } from "../src/roster";
import { PokerMatch, POKER_ROUNDS } from "../src/poker/state";
import { cpuExchange, cpuWantsConfirm } from "../src/poker/ai";
import { handSummary } from "../src/poker/effects";

const N = Number(process.env.N ?? 200);
const HOME = Number(process.env.HOME_TEAM ?? 0);

let lockRound = new Map<number, number>();
let bothBuffed = 0, homeOnly = 0, awayOnly = 0, neither = 0;
let revealedEarly = 0;
const ranks: Record<number, Map<string, number>> = { 0: new Map(), 1: new Map() };
let exchanges = [0, 0];

for (let n = 0; n < N; n++) {
  const m = new PokerMatch(ROSTER, HOME, 1000 + n);
  const away = 1 - m.home;
  let guard = 0;
  while (m.active && guard++ < 20) {
    // UI と同じ手番: アウェイ → ホーム（ホームは相手を見てから確定を決められる）
    for (const t of [away, m.home]) {
      if (!m.canExchange(t)) continue;
      const before = m.teams[t].exchanges;
      cpuExchange(m, t, ROSTER);
      if (m.teams[t].exchanges > before) exchanges[t]++;
    }
    // ⚠️ 確定する前に手札が公開されていないこと（公開のタイミングはホームの権利）。
    if (m.stage !== "done" && (m.teams[0].locked || m.teams[1].locked)) revealedEarly++;
    if (cpuWantsConfirm(m)) m.confirm();
    else m.carryOver();
  }
  lockRound.set(m.lockedAtRound, (lockRound.get(m.lockedAtRound) ?? 0) + 1);
  for (const t of [0, 1]) {
    const r = m.teams[t].rank;
    if (r) ranks[t].set(r.name, (ranks[t].get(r.name) ?? 0) + 1);
  }
  // 両チームに強化が乗ったか（役ぶん + 捨て札ぶん）
  const got = [0, 1].map((t) => m.applied.some((d) => d.team === t && d.amount !== 0));
  if (got[0] && got[1]) bothBuffed++;
  else if (got[m.home]) homeOnly++;
  else if (got[away]) awayOnly++;
  else neither++;
  m.revert();
}

console.log(`${N} 試合ぶん（ホーム = team${HOME}）`);
console.log(`交換した回数: team0 ${exchanges[0]} / team1 ${exchanges[1]}`);
console.log(`確定前に手札が見えていた回数: ${revealedEarly}（0 でなければ公開タイミングの権利が壊れている）`);
console.log("確定したラウンド: " + [...lockRound].sort((a, b) => a[0] - b[0])
  .map(([r, c]) => `R${r} ${c}回`).join(" / ") + `（上限 ${POKER_ROUNDS}）`);
console.log(`強化が両チームに乗った: ${bothBuffed} / ホームだけ ${homeOnly} / アウェイだけ ${awayOnly} / どちらも無し ${neither}`);
for (const t of [0, 1]) {
  const top = [...ranks[t]].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  team${t} の役: ` + top.map(([k, v]) => `${k} ${v}`).join(" / "));
}
// 顔アイコンが光る人数（bonusOf が 0 でない選手）= 「強化されているのが分かる」対象
{
  let plus = 0, minus = 0, zero = 0, games = 0;
  for (let n = 0; n < 50; n++) {
    const m = new PokerMatch(ROSTER, HOME, 500 + n);
    while (m.active) {
      for (const t of [1 - m.home, m.home]) if (m.canExchange(t)) cpuExchange(m, t, ROSTER);
      if (cpuWantsConfirm(m)) m.confirm(); else m.carryOver();
    }
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < ROSTER[t].length; i++) {
        const b = m.bonusOf(t, i, "discard");
        if (b > 0) plus++; else if (b < 0) minus++; else zero++;
      }
    }
    games++;
    m.revert();
  }
  const per = (v: number): string => (v / games).toFixed(1);
  console.log("顔アイコンの光り方 = 個人に置かれた札だけ（50試合・1試合26人）: 強化(金) " + per(plus) + "人"
    + " / 妨害(赤) " + per(minus) + "人 / 変化なし " + per(zero) + "人");
}

// 役の効果が「チーム全員」に乗るかを1例で確認する
{
  const m = new PokerMatch(ROSTER, HOME, 7);
  while (m.active) {
    for (const t of [1 - m.home, m.home]) if (m.canExchange(t)) cpuExchange(m, t, ROSTER);
    if (cpuWantsConfirm(m)) m.confirm(); else m.carryOver();
  }
  for (const t of [0, 1]) {
    const hand = m.applied.filter((d) => d.team === t && d.source === "hand");
    const disc = m.applied.filter((d) => d.team === t && d.source === "discard");
    console.log(`  team${t}: 役 ${m.teams[t].rank?.name}（${handSummary(m.teams[t].rank!)}）`
      + ` → 役による強化 ${hand.length}件 / 捨て札 ${disc.length}件`
      + ` / 受けた選手 ${new Set(hand.map((d) => d.idx)).size}人`);
  }
  m.revert();
}
