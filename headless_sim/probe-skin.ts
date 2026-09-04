// 生ボクセルのスキニングが効いているかを実測する。
// ① 各頂点に複数の骨が効いているか（＝関節で混ざるか。1本だけなら剛体と同じで裂ける）
// ② 肘まわりの頂点が、上腕と前腕の両方の影響を受けているか
import { readFileSync } from "node:fs";
import { parseVox, standardOfForTest as standardOf } from "../src/voxraw";

const DIR = process.env.DIR ?? "public/vox/player_one";
const rd = <T>(f: string): T => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as T;
const manifest = rd<{ parts: { prefix: string; grid: string; weights?: string }[] }>("manifest.json");

let total = 0;
const infl = new Map<number, number>();          // 効く骨の本数 → ボクセル数
const pairs = new Map<string, number>();          // 混ざっている骨の組み合わせ
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
      const acc = new Map<string, number>();
      for (const [bi, ww] of list ?? []) {
        const std = standardOf(w!.bones[bi] ?? "");
        if (!std || !(ww > 0)) continue;
        acc.set(std, (acc.get(std) ?? 0) + ww);
      }
      const n = Math.min(4, acc.size);
      infl.set(n, (infl.get(n) ?? 0) + 1);
      if (acc.size >= 2) {
        const k = [...acc.keys()].sort().slice(0, 2).join("+");
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
      total++;
    }
  }
}
console.log(`ボクセル ${total.toLocaleString()}`);
console.log("効く骨の本数（1本だけ＝剛体と同じ／2本以上＝関節で混ざる）:");
for (const n of [...infl.keys()].sort()) {
  const c = infl.get(n)!;
  console.log(`  ${n}本 ${String(c).padStart(7)}  ${(100 * c / total).toFixed(1)}%`);
}
const mixed = total - (infl.get(0) ?? 0) - (infl.get(1) ?? 0);
console.log(`→ 2本以上で混ざるボクセル ${mixed.toLocaleString()} (${(100 * mixed / total).toFixed(1)}%)`);
console.log("\n混ざっている骨の組み合わせ 上位:");
for (const [k, c] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${k.padEnd(30)} ${c}`);
