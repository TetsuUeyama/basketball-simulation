// 生ボクセルが標準ボーンへ正しく振り分けられているかを見る。
// 左右が対称でなければ振り分けのバグ（"Left"4文字/"Right"5文字の切り出しずれ等）。
import { readFileSync } from "node:fs";
import { parseVox, standardOfForTest as standardOf } from "../src/voxraw";

const DIR = process.env.DIR ?? "public/vox/player_one";
const rd = <T>(f: string): T => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as T;
const manifest = rd<{ parts: { prefix: string; grid: string; weights?: string }[] }>("manifest.json");
const per = new Map<string, number>();
let unmapped = 0, total = 0;
const unmappedNames = new Map<string, number>();

for (const p of manifest.parts) {
  const grid = rd<{ chunks?: { vox_file: string }[] }>(p.grid);
  const chunks = grid.chunks?.length ? grid.chunks.map((c) => c.vox_file) : [`${p.prefix}.vox`];
  const w = p.weights ? rd<{ bones: string[]; weights: [number, number][][] }>(p.weights) : null;
  let wi = 0;
  for (const f of chunks) {
    const buf = readFileSync(`${DIR}/${f}`);
    const { voxels } = parseVox(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    for (const _v of voxels) {
      const list = w?.weights[wi++];
      let name = "";
      if (list?.length) {
        let best = list[0];
        for (const e of list) if (e[1] > best[1]) best = e;
        name = w!.bones[best[0]] ?? "";
      }
      const std = standardOf(name);
      if (!std) { unmapped++; unmappedNames.set(name, (unmappedNames.get(name) ?? 0) + 1); }
      const key = std ?? "(未対応→Hips)";
      per.set(key, (per.get(key) ?? 0) + 1);
      total++;
    }
  }
}
console.log(`合計 ${total.toLocaleString()} ボクセル / 未対応 ${unmapped.toLocaleString()}`);
if (unmapped) console.log("  未対応の骨:", [...unmappedNames].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n || "(重み無し)"}:${c}`).join(" "));
console.log("\n骨ごとの割り当て（左右で揃っているか）:");
const names = [...per.keys()].sort();
const shown = new Set<string>();
for (const n of names) {
  if (shown.has(n)) continue;
  if (n.startsWith("Left")) {
    const r = "Right" + n.slice(4);
    const a = per.get(n) ?? 0, b = per.get(r) ?? 0;
    const diff = a + b ? Math.abs(a - b) / ((a + b) / 2) : 0;
    console.log(`  ${n.padEnd(14)} ${String(a).padStart(7)}   ${r.padEnd(15)} ${String(b).padStart(7)}   差 ${(diff * 100).toFixed(1)}% ${diff > 0.2 ? "★" : ""}`);
    shown.add(n); shown.add(r);
  }
}
for (const n of names) if (!shown.has(n)) console.log(`  ${n.padEnd(14)} ${String(per.get(n)).padStart(7)}`);
