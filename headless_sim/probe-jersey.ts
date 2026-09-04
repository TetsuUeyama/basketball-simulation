// ユニフォームの柄（背番号・名前・サイドライン）がボクセルに入っているかを、
// 黄色のボクセルだけを背面へ投影した文字絵で確かめる。
import { readFileSync } from "node:fs";
import { parseVox } from "../src/voxraw";

const DIR = "C:/Users/user/developsecond/game-assets/vox-model/player_one";
const grid = JSON.parse(readFileSync(`${DIR}/jersey.grid.json`, "utf8"));
type Cell = { x: number; y: number; z: number; c: number[] };
const all: Cell[] = [];
for (const ch of grid.chunks) {
  const buf = readFileSync(`${DIR}/${ch.vox_file}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { voxels, palette } = parseVox(ab);
  const ox = Math.round((ch.grid_origin[0] - grid.grid_origin[0]) / grid.voxel_size);
  const oy = Math.round((ch.grid_origin[1] - grid.grid_origin[1]) / grid.voxel_size);
  const oz = Math.round((ch.grid_origin[2] - grid.grid_origin[2]) / grid.voxel_size);
  for (const v of voxels) all.push({ x: v[0] + ox, y: v[1] + oy, z: v[2] + oz, c: palette[v[3] - 1] ?? [0, 0, 0] });
}
const yellow = (c: number[]): boolean => c[0] > 190 && c[1] > 190 && c[2] < 120;
const ys = all.map((v) => v.y).sort((a, b) => a - b);
const midY = ys[Math.floor(ys.length / 2)];
console.log(`ジャージ 総ボクセル ${all.length}  黄色 ${all.filter((v) => yellow(v.c)).length}`);
console.log(`Y の中央 ${midY}（モデルは -Y 向き＝ Y が大きい側が背中）`);

// 背中側（y >= midY）の黄色を X-Z へ投影して文字絵にする
const back = all.filter((v) => v.y >= midY && yellow(v.c));
if (!back.length) { console.log("背中側に黄色なし"); } else {
  const xs = back.map((v) => v.x), zs = back.map((v) => v.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const W = 76, H = 34;
  const g: string[][] = Array.from({ length: H }, () => Array(W).fill(" "));
  for (const v of back) {
    const cx = Math.round(((v.x - x0) / Math.max(1, x1 - x0)) * (W - 1));
    const cy = Math.round((1 - (v.z - z0) / Math.max(1, z1 - z0)) * (H - 1));
    g[cy][cx] = "#";
  }
  console.log(`背中側の黄色 ${back.length}個 を投影（X ${x1 - x0 + 1}セル × Z ${z1 - z0 + 1}セル）:`);
  for (const row of g) console.log("  " + row.join(""));
}
