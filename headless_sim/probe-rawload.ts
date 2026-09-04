// 確認ページが読む public/vox/<name> を、同じ手順で読み切れるか検証する。
// ボクセル数と weights の件数が一致するか（チャンクをまたぐ添字ずれの検出）も見る。
import { readFileSync, existsSync } from "node:fs";
import { parseVox } from "../src/voxraw";

const DIR = process.env.DIR ?? "public/vox/player_one";
const rd = <T>(f: string): T => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as T;
const manifest = rd<{ parts: { prefix: string; grid: string; weights?: string; chunks?: string[] }[] }>("manifest.json");
let ok = true, total = 0;
for (const p of manifest.parts) {
  const need = [p.grid, p.weights, ...(p.chunks ?? [])].filter(Boolean) as string[];
  const miss = need.filter((f) => !existsSync(`${DIR}/${f}`));
  if (miss.length) { console.log(`  ${p.prefix}: ★ 足りない ${miss.join(" ")}`); ok = false; continue; }
  const grid = rd<{ voxel_size: number; chunks?: { vox_file: string }[] }>(p.grid);
  const chunks = grid.chunks?.length ? grid.chunks.map((c) => c.vox_file) : [`${p.prefix}.vox`];
  let n = 0;
  for (const f of chunks) {
    const buf = readFileSync(`${DIR}/${f}`);
    n += parseVox(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer).voxels.length;
  }
  const w = p.weights ? rd<{ weights: unknown[]; bones: string[] }>(p.weights) : null;
  const match = !w || w.weights.length === n;
  if (!match) ok = false;
  total += n;
  console.log(`  ${p.prefix.padEnd(8)} ボクセル ${String(n).padStart(7)} / weights ${String(w?.weights.length ?? 0).padStart(7)} ${match ? "一致" : "★ずれ"} / 骨 ${w?.bones.length ?? 0} @${(grid.voxel_size * 1000).toFixed(2)}mm`);
}
console.log(`  合計 ${total.toLocaleString()} ボクセル / ${ok ? "全部読める" : "★ 読めないものがある"}`);
