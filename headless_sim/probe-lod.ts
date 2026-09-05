// 粗い版がどれだけ軽いか、Babylon の LOD 切り替えが二重描きにならないかを見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, UniversalCamera, Vector3, type Mesh } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const engine = new NullEngine({ renderWidth: 1600, renderHeight: 900 });
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");
await m.loadHair("hairstyle_001");
console.log(`粗さ: ボクセル ${m.lodStep} 個ぶんの塊`);
console.log("部位            近景の三角形   遠景の三角形   減り");
let a = 0, b = 0;
for (const [name, mesh] of m.byPart) {
  const lod = m.lodPart(name);
  const t0 = (mesh as Mesh).getTotalIndices() / 3;
  const t1 = lod ? lod.getTotalIndices() / 3 : t0;
  a += t0; b += t1;
  console.log(`${name.padEnd(14)}${String(t0).padStart(12)}${String(t1).padStart(14)}   ${(100 - t1 / t0 * 100).toFixed(0)}%`);
}
console.log(`${"合計".padEnd(14)}${String(a).padStart(12)}${String(b).padStart(14)}   ${(100 - b / a * 100).toFixed(0)}%`);
console.log(`26人ぶん: ${(a * 26 / 1e6).toFixed(2)}M → ${(b * 26 / 1e6).toFixed(2)}M`);

// Babylon の LOD で二重に描かれないか
const near = m.byPart.get("jersey")!;
const far = m.lodPart("jersey")!;
far.setEnabled(true);
far.parent = near.parent;
near.addLODLevel(8, far);
const cam = new UniversalCamera("c", new Vector3(0, 1.2, -30), scene);
cam.setTarget(new Vector3(0, 1.2, 0));
scene.activeCamera = cam;
scene.render();
const act = scene.getActiveMeshes();
const names: string[] = [];
for (let i = 0; i < act.length; i++) {
  const n = act.data[i].name;
  if (n.includes("jersey")) names.push(n);
}
console.log(`\n30m 離れたときに描かれた jersey 系: ${names.join(", ") || "なし"}`);
cam.position = new Vector3(0, 1.2, -3);
scene.render();
const act2 = scene.getActiveMeshes(); const names2: string[] = [];
for (let i = 0; i < act2.length; i++) { const n = act2.data[i].name; if (n.includes("jersey")) names2.push(n); }
console.log(`3m のときに描かれた jersey 系: ${names2.join(", ") || "なし"}`);
