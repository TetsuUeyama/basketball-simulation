// 同じ向き・同じ色で隣り合う面を1枚の四角にまとめたら、どれだけ減るかを見積もる。
// （見た目は変わらない。頂点色が同じ面だけをまとめるため。）
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, type Mesh } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const m = await buildRawModel(new Scene(new NullEngine()), "/vox/player_one");
await m.loadHair("hairstyle_001");

const S = 0.00938;
console.log("部位            面の数    まとめた後   減り");
let a0 = 0, a1 = 0;
for (const [name, mesh] of m.byPart) {
  const p = (mesh as Mesh).getVerticesData("position")!;
  const n = (mesh as Mesh).getVerticesData("normal")!;
  const c = (mesh as Mesh).getVerticesData("color")!;
  const faces = p.length / 12;                    // 4頂点で1面
  const s = name === "jerseymark" || name === "face" ? S / 2 : S;
  // (向き, 面の位置, 色) ごとに、面上の格子座標を集める
  const groups = new Map<string, Set<string>>();
  for (let f = 0; f < faces; f++) {
    const i = f * 4;
    const nx = Math.round(n[i * 3]), ny = Math.round(n[i * 3 + 1]), nz = Math.round(n[i * 3 + 2]);
    const cx = (p[i * 3] + p[i * 3 + 3] + p[i * 3 + 6] + p[i * 3 + 9]) / 4;
    const cy = (p[i * 3 + 1] + p[i * 3 + 4] + p[i * 3 + 7] + p[i * 3 + 10]) / 4;
    const cz = (p[i * 3 + 2] + p[i * 3 + 5] + p[i * 3 + 8] + p[i * 3 + 11]) / 4;
    const col = [0, 1, 2].map((k) => Math.round(c[i * 4 + k] * 255)).join(",");
    const g = [Math.round(cx / s * 2), Math.round(cy / s * 2), Math.round(cz / s * 2)];
    const axis = nx ? 0 : ny ? 1 : 2;
    const key = `${nx},${ny},${nz}|${g[axis]}|${col}`;
    const uv = axis === 0 ? [g[1], g[2]] : axis === 1 ? [g[0], g[2]] : [g[0], g[1]];
    let set = groups.get(key); if (!set) { set = new Set(); groups.set(key, set); }
    set.add(uv.join(","));
  }
  // 貪欲に長方形へまとめる
  let quads = 0;
  for (const set of groups.values()) {
    const left = new Set(set);
    while (left.size) {
      const first = left.values().next().value as string;
      const [u0, v0] = first.split(",").map(Number);
      let w = 0; while (left.has(`${u0 + (w + 1) * 2},${v0}`)) w++;
      let h = 0;
      outer: for (;;) {
        for (let k = 0; k <= w; k++) if (!left.has(`${u0 + k * 2},${v0 + (h + 1) * 2}`)) break outer;
        h++;
      }
      for (let j = 0; j <= h; j++) for (let k = 0; k <= w; k++) left.delete(`${u0 + k * 2},${v0 + j * 2}`);
      quads++;
    }
  }
  a0 += faces; a1 += quads;
  console.log(`${name.padEnd(14)}${String(faces).padStart(8)}${String(quads).padStart(12)}   ${(100 - quads / faces * 100).toFixed(0)}%`);
}
console.log(`${"合計".padEnd(14)}${String(a0).padStart(8)}${String(a1).padStart(12)}   ${(100 - a1 / a0 * 100).toFixed(0)}%`);
console.log(`三角形 ${(a0 * 2 / 1000).toFixed(0)}k → ${(a1 * 2 / 1000).toFixed(0)}k（26人で ${(a0 * 2 * 26 / 1e6).toFixed(2)}M → ${(a1 * 2 * 26 / 1e6).toFixed(2)}M）`);
