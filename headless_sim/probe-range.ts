// deepThreeOK(90/90) を満たす選手が何人いるか。= 射程が「ライン+0.5m」に固定される人数。
import "./stubs";
import { PLAYER_DB } from "../src/data/player-data/index";
import { ATTR_META } from "../src/attributes";
const i3a = ATTR_META.findIndex((m) => m.key === "threeAcc");
const i3r = ATTR_META.findIndex((m) => m.key === "threeRange");
let deep = 0, n = 0;
const hist = new Map<number, number>();
for (const p of PLAYER_DB) {
  const r = p[3] as number[];
  n++;
  if ((r[i3a] ?? 0) >= 90 && (r[i3r] ?? 0) >= 90) deep++;
  const b = Math.floor((r[i3r] ?? 0) / 5) * 5;
  hist.set(b, (hist.get(b) ?? 0) + 1);
}
console.log(`選手DB ${n}人  deepThreeOK(3P精度90以上 かつ L速度90以上): ${deep}人 (${(deep / n * 100).toFixed(2)}%)`);
console.log("→ 残り全員の射程は effShootRange で「3Pライン + 0.5m = 7.25m」に固定される");
console.log("\nL速度(threeRange)の分布:");
[...hist.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, v]) =>
  console.log(`  ${k}〜${k + 5}: ${String(v).padStart(4)} ${"#".repeat(Math.round(v / n * 200))}`));
