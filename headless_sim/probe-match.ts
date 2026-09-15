// 守備のマッチアップ（slot一致）で、どれだけ適性外の組み合わせが起きているか。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { PLAYER_DB } from "../src/data/player-data/index";
import { POS_BIT, roleFit } from "../src/ai/lineups";
const dbRole = new Map<string, string>(), dbMask = new Map<string, number>();
for (const p of PLAYER_DB) { dbRole.set(p[0] as string, p[1] as string); dbMask.set(p[0] as string, (p[9] as number) ?? 0); }
const SLOT_POS = ["PG", "SG", "SF", "PF", "C"];
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);

let n = 0, badFit = 0;
// 相手のポストアンカー（ゴール下に住むビッグ）に付いている守備者
let aN = 0, aGuard = 0, aShort = 0, aBadFit = 0;
const hDiff: number[] = [];
const pairs = new Map<string, number>();
const why = new Map<string, number>();
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 60) continue;
    for (let t = 0; t < 2; t++) {
      const off = game.teamPlayers(t), def = game.teamPlayers(1 - t);
      const anchor = game.postAnchor(t);
      for (const d of def) {
        const man = off[d.slot]; if (!man) continue;
        n++;
        // 守備者が「担当が居るスロットの位置」に適格か
        const slot = SLOT_POS[man.slot] ?? man.role;
        const ok = roleFit({ role: dbRole.get(d.name) ?? d.role, name: d.name, posMask: d.posMask }, slot) > 0;
        if (!ok) badFit++;
        if (man === anchor) {
          aN++;
          hDiff.push(d.height - man.height);
          const dr = dbRole.get(d.name) ?? d.role;
          if (dr === "PG" || dr === "SG") {
            aGuard++;
            // roleFit のどの条件で通っているか
            const mask = dbMask.get(d.name) ?? 0;
            const viaMask = (mask & (POS_BIT[slot] ?? 0)) !== 0;
            const viaLabel = d.role === slot;
            const k2 = viaMask ? (viaLabel ? "posMask と ラベル 両方" : "posMask で適格")
              : viaLabel ? "上書きされた role ラベルだけで適格" : "どれでもない";
            why.set(k2, (why.get(k2) ?? 0) + 1);
          }
          if (man.height - d.height > 0.08) aShort++;
          if (!ok) aBadFit++;
          const k = `${dr} が ${dbRole.get(man.name) ?? man.role} を守る`;
          pairs.set(k, (pairs.get(k) ?? 0) + 1);
        }
      }
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  マッチアップ標本 ${n}`);
console.log(`  担当のスロット位置に適性が無い守備者: ${pc(badFit, n)}`);
console.log(`\n相手のポストアンカー(ゴール下のビッグ)に付いている守備者 ${aN}件:`);
console.log(`  本来ガード(PG/SG)だった: ${pc(aGuard, aN)}`);
console.log(`  相手より 8cm 以上低い:   ${pc(aShort, aN)}`);
console.log(`  そのスロットに適性なし:   ${pc(aBadFit, aN)}`);
hDiff.sort((a, b) => a - b);
const q = (f: number) => hDiff.length ? (hDiff[Math.floor((hDiff.length - 1) * f)] * 100).toFixed(0) + "cm" : "-";
console.log(`  身長差(守備−攻撃): 最小 ${q(0)} / 25% ${q(0.25)} / 中央 ${q(0.5)} / 75% ${q(0.75)} / 最大 ${q(1)}`);
console.log("\n多い組み合わせ:");
[...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([k, v]) => console.log(`  ${k}: ${pc(v, aN)}`));
