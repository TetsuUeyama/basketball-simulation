// roleFit が「どの条件」で適格を返しているかを、ロスター構築の全エントリで静的に数える。
import "./stubs";
import { clubTeam, ROSTER } from "../src/roster";
import { CLUBS } from "../src/data/club/clubdb";
import { PLAYER_DB } from "../src/data/player-data/index";
import { POS_BIT } from "../src/ai/lineups";
const dbRole = new Map<string, string>(), dbMask = new Map<string, number>();
for (const p of PLAYER_DB) { dbRole.set(p[0] as string, p[1] as string); dbMask.set(p[0] as string, (p[9] as number) ?? 0); }
const SLOT = ["PG", "SG", "SF", "PF", "C", "PG", "SG", "SF", "PF", "C", "SG", "SF", "PF"];
let n = 0;
const why = new Map<string, number>();
const guardInBig = new Map<string, number>();
let gN = 0;
for (let c = 0; c < CLUBS.length; c++) {
  clubTeam(0, c);
  for (let i = 0; i < 13; i++) {
    const d = ROSTER[0][i];
    const slot = SLOT[i];
    const tr = dbRole.get(d.name) ?? "?";
    const mask = dbMask.get(d.name) ?? 0;
    const viaLabel = d.role === slot;              // 上書きされたラベル
    const viaMask = (mask & (POS_BIT[slot] ?? 0)) !== 0;
    n++;
    const k = viaMask ? (viaLabel ? "両方" : "posMask のみ") : viaLabel ? "上書きラベルのみ" : "どちらも不可";
    why.set(k, (why.get(k) ?? 0) + 1);
    // 本来ガードがビッグ枠(PF/C)に座っているケース
    if ((tr === "PG" || tr === "SG") && (slot === "PF" || slot === "C")) {
      gN++;
      guardInBig.set(k, (guardInBig.get(k) ?? 0) + 1);
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${CLUBS.length}クラブ × 13枠 = ${n}件`);
console.log("\nroleFit が適格を返す根拠:");
[...why.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v} (${pc(v, n)})`));
console.log(`\n本来ガード(PG/SG)がビッグ枠(PF/C)に座っている: ${gN}件 (${pc(gN, n)})`);
[...guardInBig.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  その根拠 ${k}: ${v} (${pc(v, gN)})`));
