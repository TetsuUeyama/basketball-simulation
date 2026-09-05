// 従来の焼き込みモデルで26人ぶん組む時間（生モデルとの比較用）。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildVoxelBody } = await import("../src/objects/player/player-voxel");
const engine = new NullEngine();
const scene = new Scene(engine);
const KIT = { top: { r: .8, g: .1, b: .1 }, bottom: { r: .8, g: .1, b: .1 }, shoes: { r: 1, g: 1, b: 1 } };
const t = Date.now(); const lap: number[] = [];
let verts = 0, meshes = 0;
for (let i = 0; i < 26; i++) {
  const a = Date.now();
  const b = buildVoxelBody(scene, new TransformNode(`p${i}`, scene), {
    name: `p${i}`, balance: 50, height: 1.7 + i * 0.005, skin: { r: .8, g: .6, b: .5 },
    hair: { r: .1, g: .1, b: .1 }, hairNo: 1 + i * 5, kit: KIT, jerseyText: String(i),
  });
  lap.push(Date.now() - a);
  meshes += b.meshes.length;
  for (const m of b.meshes) verts += m.getTotalVertices();
}
console.log(`焼き込み 26人: ${Date.now() - t}ms  (1人 ${Math.round(lap.reduce((x, y) => x + y, 0) / 26)}ms)`);
console.log(`メッシュ ${meshes} 個 / 頂点 ${(verts / 1e6).toFixed(2)}M`);
