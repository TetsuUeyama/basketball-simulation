// ポーカー強化のバランス実測。workPlan の目標:
//   (1) 片側だけがポーカーを使ったときの勝率 < 60%
//   (2) 戦力差のある対戦で、ポーカーによる勝敗の逆転が 10% 未満
// 条件を MODE で切り替え、同じクラブ対戦カードを両条件で回して比べる。
//   MODE=off    ポーカー無し（基準）
//   MODE=both   両チームがポーカー（実プレイの既定）
//   MODE=one    team0 だけがポーカー（強化の総量を測る）
//   MODE=max    team0 が毎回ロイヤルストレートフラッシュ（上振れの上限）
//   MODE=dump   team0 が毎ラウンド手札5枚を全部捨てる（個人強化に全振りする打ち方）
// 実行:
//   npx esbuild headless_sim/probe-poker-balance.ts --bundle --platform=node --format=esm \
//     --outfile=headless_sim/probe-poker-balance.mjs && MODE=one GAMES=200 node headless_sim/probe-poker-balance.mjs
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { ROSTER, ROSTER_SIZE, clubTeam } from "../src/roster";
import { CLUBS } from "../src/data/club/clubdb";
import { ATTR_META, type Attributes, type PlayerDef } from "../src/attributes";
import { PokerMatch, POKER_ROUNDS } from "../src/poker/state";
import { cpuExchange, cpuWantsConfirm, pickTarget } from "../src/poker/ai";
import type { Card } from "../src/poker/cards";

const engine = new NullEngine();
const scene = new Scene(engine);
const hoops = buildCourt(scene);
const game = new Game(scene);
game.attackGoalZ;   // 参照だけ（型の生存確認）
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);

const DT = 0.1;
const MODE = process.env.MODE ?? "both";
const GAMES = Number(process.env.GAMES ?? 200);

/** team1 の強化を捨てる先（"one"/"max" で team0 だけに効かせるためのダミー）。 */
function cloneRoster(defs: PlayerDef[]): PlayerDef[] {
  return defs.map((d) => ({ ...d, attr: { ...d.attr } as Attributes }));
}

const ROYAL: Card[] = [
  { suit: "S", rank: 10 }, { suit: "S", rank: 11 }, { suit: "S", rank: 12 },
  { suit: "S", rank: 13 }, { suit: "S", rank: 1 },
];

/** その試合のポーカーを仕込む。null を返したらポーカー無し。 */
function setupPoker(seed: number): PokerMatch | null {
  if (MODE === "off") return null;
  const roster: PlayerDef[][] = MODE === "both"
    ? [ROSTER[0], ROSTER[1]]
    : [ROSTER[0], cloneRoster(ROSTER[1])];   // team1 の強化は捨てる
  const m = new PokerMatch(roster, 0, seed);
  if (MODE === "max") m.teams[0].hand = ROYAL.map((c) => ({ ...c }));
  return m;
}

/** ラウンドを CPU で解決する（UI の代わり）。 */
function driveRound(m: PokerMatch, roster: PlayerDef[][]): void {
  if (MODE === "dump") {
    // 役を捨てて個人強化に全振りする打ち方。役は最終ラウンドで自動確定する。
    const hand = m.teams[0].hand;
    const picks = hand.map((_, i) => i);
    m.exchange(0, picks, picks.map((i) => pickTarget(hand[i], roster, 0)));
    m.carryOver();   // team1 は打たない（team0 だけの効果を測る）
    return;
  }
  if (MODE === "max") {
    // 上振れの上限を見るので交換せず、最初のラウンドで確定する
    m.confirm();
    return;
  }
  cpuExchange(m, 0, roster);
  // "one"/"dump" は team0 だけの効果を測る条件なので team1 は打たせない。
  // （妨害が入って以降、team1 に打たせると team0 の能力値へ直接効いてしまう）
  if (MODE === "both") cpuExchange(m, 1, roster);
  if (cpuWantsConfirm(m)) m.confirm();
  else m.carryOver();
}

/** 先発5人の平均総合力（戦力差の指標）。 */
function teamPower(defs: PlayerDef[]): number {
  let s = 0;
  for (let i = 0; i < 5; i++) {
    for (const meta of ATTR_META) s += defs[i].attr[meta.key];
  }
  return s / (5 * ATTR_META.length);
}

let win0 = 0, draw = 0;
let pts0 = 0, pts1 = 0;
let gapWin = 0, gapGames = 0;      // 戦力で劣る側がポーカー込みで勝った回数
let flipCandidates = 0;
const kinds: Record<string, number> = {};
let sumBonus = 0;

const t0 = Date.now();
for (let n = 0; n < GAMES; n++) {
  clubTeam(0, n % CLUBS.length);
  clubTeam(1, (n * 7 + 3) % CLUBS.length);
  const power = [teamPower(ROSTER[0]), teamPower(ROSTER[1])];

  const m = setupPoker(n + 1);
  const pokerRoster: PlayerDef[][] = m ? [ROSTER[0], MODE === "both" ? ROSTER[1] : cloneRoster(ROSTER[1])] : [];
  game.poker = m;
  game.onPokerRound = m ? () => { driveRound(m, pokerRoster); game.resumeFromPoker(); } : null;

  game.applyRoster();
  if (m) {
    // ラウンド1（試合開始前）
    driveRound(m, pokerRoster);
    game.applyRoster();
  }
  game.reset();

  let guard = 0;
  while (game.state !== "final" && guard++ < 400000) game.update(DT);

  const s0 = game.score[0], s1 = game.score[1];
  pts0 += s0; pts1 += s1;
  if (s0 > s1) win0++; else if (s0 === s1) draw++;

  // 戦力で劣る側が勝ったか（差 1.0 以上を「戦力差あり」とみなす）
  const gap = power[0] - power[1];
  if (Math.abs(gap) >= 1.0) {
    gapGames++;
    const underdog = gap < 0 ? 0 : 1;
    const winner = s0 === s1 ? -1 : (s0 > s1 ? 0 : 1);
    if (winner === underdog) gapWin++;
    if (underdog === 0) flipCandidates++;
  }

  if (m) {
    kinds[m.teams[0].rank?.kind ?? "none"] = (kinds[m.teams[0].rank?.kind ?? "none"] ?? 0) + 1;
    for (const d of m.applied) if (d.team === 0) sumBonus += d.amount;
    m.revert();               // ロスターdefを元に戻す（次の試合へ持ち越さない）
  }
  game.poker = null;
  game.onPokerRound = null;
  if ((n + 1) % 50 === 0) process.stderr.write(`  ${n + 1}/${GAMES}\r`);
}

const pct = (v: number) => (100 * v / GAMES).toFixed(1);
console.log(`\nMODE=${MODE}  ${GAMES}試合  ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
console.log(`  team0 勝率 ${pct(win0)}%  引き分け ${pct(draw)}%`);
console.log(`  平均スコア ${(pts0 / GAMES).toFixed(1)} - ${(pts1 / GAMES).toFixed(1)}  (差 ${((pts0 - pts1) / GAMES).toFixed(2)})`);
if (gapGames) console.log(`  戦力差のある試合 ${gapGames} 件中、格下の勝ち ${gapWin} 件 = ${(100 * gapWin / gapGames).toFixed(1)}%`);
if (Object.keys(kinds).length) {
  console.log(`  team0 の確定役:`, Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}:${c}`).join(" "));
  console.log(`  team0 が受けた強化 平均 ${(sumBonus / GAMES).toFixed(0)} 点/試合 (13人×25能力の合計)`);
}
void ROSTER_SIZE; void POKER_ROUNDS; void flipCandidates;
