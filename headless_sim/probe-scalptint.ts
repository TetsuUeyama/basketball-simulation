// 髪の下になる頭皮を髪色に塗る処理（voxraw.ts applyScalpTint）を実測する。
// 見たいこと:
//   1. 髪型ごとに何ボクセル塗り替わるか（0 なら効いていない）
//   2. 塗った色が本当に髪の色か
//   3. 顔（目・鼻・口）が塗られていないか
//   4. 「髪なし」で元の肌色へ戻るか
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";

const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () => ab,
    };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};

const { buildRawModel } = await import("../src/voxraw");

const engine = new NullEngine();
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");

const body = m.byPart.get("body")!;
const base = Array.from(body.getVerticesData("color")!);
const pos = body.getVerticesData("position")!;
const nVerts = base.length / 4;

/** 色の種類を数える（丸めてから）。上位いくつかを返す。 */
const hist = (cols: number[], pick?: (i: number) => boolean): [string, number][] => {
  const h = new Map<string, number>();
  for (let i = 0; i < cols.length / 4; i++) {
    if (pick && !pick(i)) continue;
    const k = [0, 1, 2].map((c) => Math.round(cols[i * 4 + c] * 255)).join(",");
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  return [...h].sort((a, b) => b[1] - a[1]);
};

// Babylon 側の座標: y=高さ / z=前後（-z が前＝顔）。toBabylon が (x,y,z)->(-x, z, -y) なので
// Blender の y<0（顔側）は Babylon の z>0 になる。
let topY = -Infinity;
for (let i = 0; i < nVerts; i++) topY = Math.max(topY, pos[i * 3 + 1]);
// ⚠️ ここで見ているのはボクセルの**角**の座標。voxraw 側は**中心**で判定しているので、
//    境界のボクセル1個ぶん(約6mm)は必ずはみ出す。それを差し引いた「明らかに顔」だけを数える。
const VOX = 0.007;
const isFace = (i: number): boolean =>
  pos[i * 3 + 2] > 0.01 + VOX && pos[i * 3 + 1] < topY - 0.09 - VOX;

console.log(`body 頂点 ${nVerts.toLocaleString()} / 頭頂Y ${topY.toFixed(3)}`);
console.log(`元の色の種類 上位3: ${hist(base).slice(0, 3).map(([k, v]) => `${k}=${v}`).join("  ")}`);

// ⚠️ 頂点カラーは float32 で保持される一方、更新時に渡すのは double。
// === で比べると丸め差で全頂点が「変化した」ことになる。許容差で見る。
const DIFF = (a: number[], b: number[], i: number): boolean =>
  [0, 1, 2].some((c) => Math.abs(a[i * 4 + c] - b[i * 4 + c]) > 1 / 512);

const hairs = ["hair", ...[...m.byPart.keys()].filter((k) => k.startsWith("hairstyle_")).sort()];
let bad = 0;
for (const h of hairs) {
  const n = m.applyScalpTint(h);
  const cols = Array.from(body.getVerticesData("color")!);
  // 塗り替わった頂点を洗い出す
  const changed: number[] = [];
  for (let i = 0; i < nVerts; i++) {
    if (DIFF(cols, base, i)) {
      changed.push(i);
    }
  }
  const faceHit = changed.filter(isFace).length;
  // 頭頂(上6cm)と後頭部(背面かつ額より上)のうち、何%が髪色になったか。
  // 髪の殻が浮いていても、ここが埋まっていれば地肌は見えない。
  const ch = new Set(changed);
  let crownAll = 0, crownHit = 0, backAll = 0, backHit = 0;
  for (let i = 0; i < nVerts; i++) {
    const y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y > topY - 0.06) { crownAll++; if (ch.has(i)) crownHit++; }
    if (z < -0.01 && y > topY - 0.13) { backAll++; if (ch.has(i)) backHit++; }
  }
  const top = hist(cols, (i) => changed.includes(i))[0];
  const hairMesh = m.byPart.get(h)!;
  const hc = hairMesh.getVerticesData("color")!;
  const hairRGB = [0, 1, 2].map((c) => Math.round(hc[c] * 255)).join(",");
  const ok = n > 0 && top && top[0] === hairRGB && faceHit === 0;
  if (!ok) bad++;
  console.log(`  ${h.padEnd(14)} 塗り替え ${String(n).padStart(4)} ボクセル`
    + ` / 頂点 ${String(changed.length).padStart(5)}`
    + ` / 色 ${top ? top[0] : "なし"} (髪の色 ${hairRGB})`
    + ` / 頭頂 ${((crownHit / (crownAll || 1)) * 100).toFixed(0)}% 後頭部 ${((backHit / (backAll || 1)) * 100).toFixed(0)}%`
    + ` / 顔 ${faceHit}`
    + ` ${ok ? "OK" : "★NG"}`);
}

const back = m.applyScalpTint("");
const restored = Array.from(body.getVerticesData("color")!);
const same = restored.every((v, i) => Math.abs(v - base[i]) <= 1 / 512);
console.log(`  ${"(髪なし)".padEnd(14)} 塗り替え ${back} / 元の肌色へ復元 ${same ? "OK" : "★NG"}`);
if (!same) bad++;
console.log(`\n問題のある髪型: ${bad}`);
