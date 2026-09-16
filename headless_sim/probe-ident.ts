// 交代後に「選手の識別（名前/ロール/能力）」と「スロット（＝持ち場・役割）」が
// ズレていないかを検査する。
//  ① Player 実体と ROSTER の def の結び付き（applyRoster の不変条件）
//  ② コート上の選手の role と、その slot が示すポジションの一致
//  ③ 交代が起きたあと、ROSTER の添字 0..4 が本当にコート上の5人かどうか
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam, ROSTER } from "../src/roster";
import { PLAYER_DB } from "../src/data/player-data/index";
const dbRole = new Map<string, string>();
for (const q of PLAYER_DB) dbRole.set(q[0] as string, q[1] as string);
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const SLOT_POS = ["PG", "SG", "SF", "PF", "C"];
let n = 0, bindBad = 0, roleBad = 0;
let idxN = 0, idxBad = 0;
const bySlot = new Map<string, number>();
let bigN = 0, bigGuard = 0, bigThree = 0, bigHt = 0;
const samples: string[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 300) continue;
    for (let t = 0; t < 2; t++) {
      // ① def の結び付き: roster[t][k] は ROSTER[t][k] を載せているか
      for (let k = 0; k < ROSTER[t].length; k++) {
        n++;
        if (game.roster[t][k].name !== ROSTER[t][k].name) {
          bindBad++;
          if (samples.length < 6) samples.push(`結び付きズレ team${t} idx${k}: 実体=${game.roster[t][k].name} / def=${ROSTER[t][k].name}`);
        }
      }
      // ② コート上: role と slot の位置が食い違っていないか
      for (const p of game.teamPlayers(t)) {
        if (p.role !== (SLOT_POS[p.slot] ?? p.role)) roleBad++;
        // その枠に「本来どのポジションの選手」が入っているか
        const k = `${SLOT_POS[p.slot] ?? "?"}枠 <- ${dbRole.get(p.name) ?? p.role}`;
        bySlot.set(k, (bySlot.get(k) ?? 0) + 1);
        if ((SLOT_POS[p.slot] === "C" || SLOT_POS[p.slot] === "PF")) {
          bigN++; bigThree += p.attr.threeAcc; bigHt += p.height;
          const dr = dbRole.get(p.name) ?? p.role;
          if (dr === "PG" || dr === "SG") bigGuard++;
        }
      }
      // ③ ROSTER の添字 0..4 が、本当にコート上の5人か
      const onCourt = new Set(game.teamPlayers(t).map((p) => p.name));
      for (let k = 0; k < 5; k++) {
        idxN++;
        if (!onCourt.has(ROSTER[t][k].name)) {
          idxBad++;
          if (samples.length < 12) samples.push(`添字ズレ team${t} ROSTER[${k}]=${ROSTER[t][k].name} はコート上に居ない`);
        }
      }
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合`);
console.log(`① 実体と def の結び付きズレ: ${pc(bindBad, n)} (${bindBad}/${n})`);
console.log(`② コート上で role と slot の位置が不一致: ${roleBad}件`);
console.log(`③ ROSTER の添字 0..4 がコート上に居ない: ${pc(idxBad, idxN)} (${idxBad}/${idxN})`);
console.log("");
console.log("");
console.log(`■ PF/C の枠に入っている選手 (${bigN}件)`);
console.log(`  本来ガード(PG/SG)だった: ${pc(bigGuard, bigN)}`);
console.log(`  平均3P精度: ${(bigThree / Math.max(1, bigN)).toFixed(1)} / 平均身長: ${(bigHt / Math.max(1, bigN)).toFixed(2)}m`);
console.log("");
console.log("■ 枠ごとの中身（多い順 上位10）");
[...bySlot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log(`  ${k}: ${v}`));
