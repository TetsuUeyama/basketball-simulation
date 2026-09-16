// 選手DBのポジション別 能力値。「ビッグはシュートが下手」が データ上 成立しているか。
import "./stubs";
import { PLAYER_DB } from "../src/data/player-data/index";
import { ATTR_META } from "../src/attributes";
const KEYS = ["midAcc", "threeAcc", "threeRange", "shotTech", "dunk", "jump", "defense", "speed"];
// ⚠️ Map のキーは keyof Attributes。KEYS を string[] のままにすると照合できず、
//    `idx.get(k) ?? 0` の 0 に落ちて**別の能力値を読む**（値は偶然合っていたが危うい）。
const idx = new Map<string, number>(ATTR_META.map((m, i) => [m.key as string, i]));
const byRole: Record<string, { n: number; sum: Record<string, number>; ht: number }> = {};
for (const p of PLAYER_DB) {
  const role = p[1] as string, r = p[3] as number[], hcm = p[2] as number;
  byRole[role] ??= { n: 0, sum: {}, ht: 0 };
  const a = byRole[role];
  a.n++; a.ht += hcm;
  for (const k of KEYS) a.sum[k] = (a.sum[k] ?? 0) + (r[idx.get(k) ?? 0] ?? 0);
}
console.log(`選手DB ${PLAYER_DB.length}人 のポジション別 平均`);
console.log(["ロール", "人数", "身長", ...KEYS].map((s) => String(s).padEnd(10)).join(""));
for (const role of ["PG", "SG", "SF", "PF", "C"]) {
  const a = byRole[role]; if (!a) continue;
  const row = [role, String(a.n), (a.ht / a.n / 100).toFixed(2) + "m",
    ...KEYS.map((k) => (a.sum[k] / a.n).toFixed(1))];
  console.log(row.map((s) => s.padEnd(10)).join(""));
}
