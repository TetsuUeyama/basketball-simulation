// 「適性が無いポジションに就いている」の実測。
// ①ロスター構築時点(clubTeam)で、スロットの位置が本人のDBロール/posMask に含まれない人数
// ②試合中、コート上の選手の slot 位置に対する適格率（交代後も含む）
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam, ROSTER } from "../src/roster";
import { CLUBS } from "../src/data/club/clubdb";
import { PLAYER_DB } from "../src/data/player-data/index";
import { POS_BIT, roleFit } from "../src/ai/lineups";
const SLOT_POS = ["PG", "SG", "SF", "PF", "C"];
const dbRole = new Map<string, string>();
const dbMask = new Map<string, number>();
for (const p of PLAYER_DB) { dbRole.set(p[0] as string, p[1] as string); dbMask.set(p[0] as string, (p[9] as number) ?? 0); }

// ---- ① ロスター構築 --------------------------------------------------------
let n = 0, roleBad = 0, maskBad = 0, bothBad = 0;
const samples: string[] = [];
for (let c = 0; c < CLUBS.length; c++) {
  clubTeam(0, c);
  for (let i = 0; i < 13; i++) {
    const d = ROSTER[0][i];
    const slot = d.role;                      // 構築後の role = スロットの位置
    const tr = dbRole.get(d.name) ?? "?";
    const mask = dbMask.get(d.name) ?? 0;
    n++;
    const rOK = tr === slot;
    const mOK = (mask & (POS_BIT[slot] ?? 0)) !== 0;
    if (!rOK) roleBad++;
    if (!mOK) maskBad++;
    if (!rOK && !mOK) {
      bothBad++;
      if (samples.length < 12) samples.push(`${CLUBS[c][0]} ${SLOT_POS[Math.min(i,4)]}枠#${i}: ${d.name}(本来${tr}/mask=${mask}) → ${slot}`);
    }
  }
}
console.log(`① ロスター構築 ${CLUBS.length}クラブ×13人 = ${n}人`);
console.log(`  DBロールと違うスロットに置かれた: ${roleBad} (${(roleBad/n*100).toFixed(1)}%)`);
console.log(`  posMask に含まれないスロット:     ${maskBad} (${(maskBad/n*100).toFixed(1)}%)`);
console.log(`  両方ダメ(＝完全に適性外):         ${bothBad} (${(bothBad/n*100).toFixed(1)}%)`);
for (const s of samples) console.log("    " + s);

// ---- ② 試合中のコート上 ----------------------------------------------------
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
let subs = 0;
const onCourt = new Map<number, Set<string>>();
let on = 0, onBad = 0, starterBad = 0, starterN = 0, subBad = 0, subN = 0;
let drift = 0, tipN = 0, tipBad = 0;
let badN = 0, badButRoleOK = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    for (let t = 0; t < 2; t++) {
      const cur = new Set(game.teamPlayers(t).map((q) => q.name));
      const prev = onCourt.get(t);
      if (prev) for (const nm of cur) if (!prev.has(nm)) subs++;
      onCourt.set(t, cur);
    }
    if (i % 120) continue;
    for (let t = 0; t < 2; t++) for (const p of game.teamPlayers(t)) {
      const slot = SLOT_POS[p.slot] ?? p.role;
      const ok = roleFit({ role: dbRole.get(p.name) ?? p.role, name: p.name, posMask: p.posMask }, slot) > 0;
      const isStarter = game.roster[t].indexOf(p) < 5;
      on++; if (!ok) onBad++;
      if (p.role !== slot) drift++;
      if (!ok) { badN++; if (roleFit({ role: dbRole.get(p.name) ?? p.role, name: p.name, posMask: p.posMask }, p.role) > 0) badButRoleOK++; }
      if (i === 0) { tipN++; if (!ok) tipBad++; }
      if (isStarter) { starterN++; if (!ok) starterBad++; } else { subN++; if (!ok) subBad++; }
    }
  }
}
console.log(`\n② 試合中(${NG}試合) コート上サンプル ${on}`);
console.log(`  スロット位置に適性なし: ${(onBad/on*100).toFixed(1)}%`);
console.log(`  　先発枠の選手: ${(starterBad/Math.max(1,starterN)*100).toFixed(1)}% (${starterN})`);
console.log(`  　控えの選手:   ${(subBad/Math.max(1,subN)*100).toFixed(1)}% (${subN})`);
console.log(`  ジャンプボール時点(交代前): ${(tipBad/Math.max(1,tipN)*100).toFixed(1)}% (${tipN}件)`);
console.log(`  交代で入った回数: ${subs}（${NG}試合、1チーム1試合 ${(subs / NG / 2).toFixed(1)}回）`);
console.log(`  role と実スロットの食い違い: ${(drift/on*100).toFixed(1)}%  ← 次の交代はこの role で適格判定される`);
console.log(`  適性なしのうち「自分の role なら適格」: ${(badButRoleOK/Math.max(1,badN)*100).toFixed(1)}% (${badN}件)`);
