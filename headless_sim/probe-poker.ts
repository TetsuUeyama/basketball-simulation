// ポーカー強化システムの検証。
//  1. 役判定の正しさ: 52C5 の全 2,598,960 通りを列挙し、役の頻度を理論値と突き合わせる。
//  2. 境界ケース: ホイール(A2345) / ロイヤル / A ハイストレートでないもの。
//  3. CPU 同士で1試合ぶんのポーカーを回し、乗る強化量と役の分布を実測する。
// 実行: npx esbuild headless_sim/probe-poker.ts --bundle --platform=node --format=esm
//         --outfile=headless_sim/probe-poker.mjs && node headless_sim/probe-poker.mjs
import { makeDeck, type Card } from "../src/poker/cards";
import { evalHand, type HandKind } from "../src/poker/hands";
import { PokerMatch, POKER_ROUNDS } from "../src/poker/state";
import { cpuExchange, cpuWantsConfirm } from "../src/poker/ai";
import { ATTR_META, type Attributes, type PlayerDef } from "../src/attributes";

// ---- 1. 全 52C5 の列挙 -----------------------------------------------------
const THEORY: Record<HandKind, number> = {
  royalFlush: 4,
  straightFlush: 36,
  quads: 624,
  fullHouse: 3744,
  flush: 5108,
  straight: 10200,
  trips: 54912,
  twoPair: 123552,
  pair: 1098240,
  high: 1302540,
};

function enumerateAll(): Record<string, number> {
  const deck = makeDeck();
  const count: Record<string, number> = {};
  const h: Card[] = new Array(5);
  for (let a = 0; a < 48; a++) {
    h[0] = deck[a];
    for (let b = a + 1; b < 49; b++) {
      h[1] = deck[b];
      for (let c = b + 1; c < 50; c++) {
        h[2] = deck[c];
        for (let d = c + 1; d < 51; d++) {
          h[3] = deck[d];
          for (let e = d + 1; e < 52; e++) {
            h[4] = deck[e];
            const k = evalHand(h).kind;
            count[k] = (count[k] ?? 0) + 1;
          }
        }
      }
    }
  }
  return count;
}

console.log("=== 1. 役判定: 52C5 全列挙 vs 理論値 ===");
const t0 = Date.now();
const got = enumerateAll();
let total = 0, mismatch = 0;
for (const kind of Object.keys(THEORY) as HandKind[]) {
  const g = got[kind] ?? 0;
  const t = THEORY[kind];
  total += g;
  if (g !== t) mismatch++;
  console.log(`  ${kind.padEnd(14)} 実測 ${String(g).padStart(8)} / 理論 ${String(t).padStart(8)}  ${g === t ? "OK" : "★不一致"}`);
}
console.log(`  合計 ${total} (期待 2598960) / 不一致 ${mismatch} 種 / ${Date.now() - t0}ms`);

// ---- 2. 境界ケース ---------------------------------------------------------
console.log("\n=== 2. 境界ケース ===");
const C = (s: string, r: number): Card => ({ suit: s as Card["suit"], rank: r });
const cases: { name: string; hand: Card[]; want: HandKind }[] = [
  { name: "ホイール A-2-3-4-5", hand: [C("H", 1), C("D", 2), C("S", 3), C("C", 4), C("H", 5)], want: "straight" },
  { name: "ホイールSF 同スート", hand: [C("H", 1), C("H", 2), C("H", 3), C("H", 4), C("H", 5)], want: "straightFlush" },
  { name: "ロイヤル 10-J-Q-K-A", hand: [C("S", 10), C("S", 11), C("S", 12), C("S", 13), C("S", 1)], want: "royalFlush" },
  { name: "K-A-2-3-4 は非ストレート", hand: [C("H", 13), C("D", 1), C("S", 2), C("C", 3), C("H", 4)], want: "high" },
  { name: "フルハウス", hand: [C("H", 7), C("D", 7), C("S", 7), C("C", 2), C("H", 2)], want: "fullHouse" },
];
for (const c of cases) {
  const r = evalHand(c.hand);
  console.log(`  ${c.name.padEnd(22)} → ${r.name.padEnd(20)} ${r.kind === c.want ? "OK" : `★期待 ${c.want}`}`);
}

// ---- 3. CPU 同士の1試合ぶんのポーカー --------------------------------------
// ダミーロスター（能力値は中庸の50）で、乗る強化量と確定ラウンドの分布を見る。
function dummyRoster(): PlayerDef[][] {
  const mk = (name: string): PlayerDef => {
    const attr = {} as Attributes;
    for (const m of ATTR_META) attr[m.key] = 50;
    return { name, role: "PG", height: 1.9, attr };
  };
  return [
    Array.from({ length: 13 }, (_, i) => mk(`A${i}`)),
    Array.from({ length: 13 }, (_, i) => mk(`B${i}`)),
  ];
}

const N = Number(process.env.N ?? 4000);
const kindCount: Record<string, number> = {};
const roundCount: number[] = [0, 0, 0, 0, 0];
let sumDiscard = 0, sumHand = 0, sumTotal = 0;
let maxTotal = 0;
for (let n = 0; n < N; n++) {
  const roster = dummyRoster();
  const m = new PokerMatch(roster, 0, n + 1);
  for (let r = 0; r < POKER_ROUNDS && m.active; r++) {
    cpuExchange(m, 0, roster);
    cpuExchange(m, 1, roster);
    if (cpuWantsConfirm(m)) m.confirm();
    else m.carryOver();
  }
  roundCount[m.lockedAtRound]++;
  for (const t of [0, 1]) kindCount[m.teams[t].rank?.kind ?? "none"] = (kindCount[m.teams[t].rank?.kind ?? "none"] ?? 0) + 1;
  let d = 0, hnd = 0;
  for (const a of m.applied) { if (a.team !== 0) continue; if (a.source === "discard") d += a.amount; else hnd += a.amount; }
  sumDiscard += d; sumHand += hnd; sumTotal += d + hnd;
  maxTotal = Math.max(maxTotal, d + hnd);
}
console.log(`\n=== 3. CPU 同士 ${N} 試合ぶんのポーカー (team0 の受け取り量) ===`);
console.log(`  捨て札による個人強化   平均 ${(sumDiscard / N).toFixed(1)} 点/試合`);
console.log(`  役によるチーム強化     平均 ${(sumHand / N).toFixed(1)} 点/試合 (13人×能力の合計)`);
console.log(`  合計                   平均 ${(sumTotal / N).toFixed(1)} 点 / 最大 ${maxTotal} 点`);
console.log(`  1人あたりの平均上昇     ${(sumTotal / N / 13 / 25).toFixed(2)} 点/能力`);
console.log("  確定ラウンド:", roundCount.map((c, i) => `R${i}:${(100 * c / N).toFixed(1)}%`).slice(1).join(" "));
console.log("  確定した役:", Object.entries(kindCount)
  .sort((a, b) => b[1] - a[1])
  .map(([k, c]) => `${k}:${(100 * c / (N * 2)).toFixed(1)}%`).join(" "));
