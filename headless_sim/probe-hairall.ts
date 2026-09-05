// 髪型 139 種が読めるか、髭付きがあごの形に追従するかを実測する。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const engine = new NullEngine();
const scene = new Scene(engine);
const t0 = Date.now();
const m = await buildRawModel(scene, "/vox/player_one");
console.log(`最初の読み込み ${Date.now() - t0}ms / 髪型 ${m.hairNames.length}種（まだ作っていない）`
  + ` / メッシュ ${m.meshes.length}`);

// 全種を順に読んで、失敗が無いか
let bad = 0, vox = 0;
const t1 = Date.now();
for (const n of m.hairNames) {
  const ok = await m.loadHair(n);
  const mesh = m.byPart.get(n);
  if (!ok || !mesh || !mesh.getTotalVertices()) { bad++; console.log(`  ★ ${n} が作れない`); continue; }
  vox += mesh.getTotalVertices();
}
console.log(`全 ${m.hairNames.length} 種を読み込み ${Date.now() - t1}ms / 失敗 ${bad} / 頂点合計 ${vox.toLocaleString()}`);

// 髭付き（あごの前面にボクセルがあるもの）が、あごの形で変わるか
const bodyMesh = m.byPart.get("body")!;
let topY = -Infinity;
const bpos = bodyMesh.getVerticesData("position")!;
for (let i = 0; i < bpos.length / 3; i++) topY = Math.max(topY, bpos[i * 3 + 1]);
const beardCount = (name: string): number => {
  const p = m.byPart.get(name)!.getVerticesData("position")!;
  let n = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const d = topY - p[i * 3 + 1];
    if (d > 0.175 && d < 0.245 && p[i * 3 + 2] > 0.02 && Math.abs(p[i * 3]) < 0.09) n++;
  }
  return n;
};
const beardy = m.hairNames.filter((n) => beardCount(n) >= 40);
console.log(`髭のある髪型 ${beardy.length} 種`);
const before = new Map(beardy.map((n) => [n, beardCount(n)]));
m.setJaw("narrow");
let changed = 0;
for (const n of beardy) if (beardCount(n) !== before.get(n)) changed++;
console.log(`あごを narrow にして形が変わった髭 ${changed}/${beardy.length} 種`);
