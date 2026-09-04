// voxraw.ts の .vox パーサが、パイプラインの報告値と一致するかを確認する。
import { readFileSync } from "node:fs";
import { parseVox, toBabylon } from "../src/voxraw";

const DIR = "C:/Users/user/developsecond/game-assets/vox-model/player_one";
const cases: [string, number][] = [
  ["jersey_c1.vox", 187624], ["shorts.vox", 140518], ["shoes.vox", 41028], ["body_c1.vox", 22313],
];
let ok = 0;
for (const [f, expect] of cases) {
  const buf = readFileSync(`${DIR}/${f}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { voxels, palette } = parseVox(ab);
  const used = new Set(voxels.map((v) => v[3]));
  const hit = voxels.length === expect;
  if (hit) ok++;
  console.log(`  ${f.padEnd(16)} ${voxels.length} 個 (期待 ${expect}) ${hit ? "OK" : "★不一致"} / 使用色 ${used.size}種`);
  const top = [...used].slice(0, 4).map((ci) => "#" + (palette[ci - 1] ?? []).map((x) => x.toString(16).padStart(2, "0")).join(""));
  console.log(`      色の例: ${top.join(" ")}`);
}
console.log(`  → ${ok}/${cases.length} 一致`);
console.log(`  座標変換 toBabylon(1,2,3) = ${JSON.stringify(toBabylon(1, 2, 3))} （期待 [-1,3,-2]）`);
