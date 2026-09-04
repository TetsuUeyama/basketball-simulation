// スキニングメッシュ化したときの頂点/面数を見積もる。
// 隣にボクセルがある面は描かない（部位ごとの格子内で判定）。
import { readFileSync } from "node:fs";
import { parseVox } from "../src/voxraw";

const DIR = process.env.DIR ?? "public/vox/player_one";
const rd = <T>(f: string): T => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as T;
const manifest = rd<{ parts: { prefix: string; grid: string }[] }>("manifest.json");
const DIRS: [number, number, number][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
let vox = 0, faces = 0;
for (const p of manifest.parts) {
  const grid = rd<{ voxel_size: number; grid_origin: number[]; chunks?: { vox_file: string; grid_origin: number[] }[] }>(p.grid);
  const chunks = grid.chunks?.length ? grid.chunks : [{ vox_file: `${p.prefix}.vox`, grid_origin: grid.grid_origin }];
  const S = grid.voxel_size;
  const set = new Set<string>();
  const cells: [number, number, number][] = [];
  for (const ch of chunks) {
    const buf = readFileSync(`${DIR}/${ch.vox_file}`);
    const { voxels } = parseVox(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const o = [0, 1, 2].map((i) => Math.round((ch.grid_origin[i] - grid.grid_origin[i]) / S));
    for (const v of voxels) {
      const c: [number, number, number] = [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
      cells.push(c); set.add(c.join(","));
    }
  }
  let f = 0;
  for (const c of cells) for (const d of DIRS) if (!set.has(`${c[0]+d[0]},${c[1]+d[1]},${c[2]+d[2]}`)) f++;
  vox += cells.length; faces += f;
  console.log(`  ${p.prefix.padEnd(8)} ボクセル ${String(cells.length).padStart(7)}  露出面 ${String(f).padStart(8)}  (1個あたり ${(f / cells.length).toFixed(2)}面)`);
}
console.log(`\n合計 ボクセル ${vox.toLocaleString()} / 露出面 ${faces.toLocaleString()}`);
console.log(`スキニングメッシュ: 頂点 ${(faces * 4).toLocaleString()} / 三角形 ${(faces * 2).toLocaleString()}`);
console.log(`（面を描かず立方体を素直に出すと 頂点 ${(vox * 24).toLocaleString()}）`);
