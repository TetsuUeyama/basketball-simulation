// 髪型No 0（髪なし）で元モデルの髪が残らないか、髪型を選んだとき二重にならないかを見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();
const engine = new NullEngine();
const KIT = { top: { r: .8, g: .1, b: .1 }, bottom: { r: .8, g: .1, b: .1 }, shoes: { r: 1, g: 1, b: 1 } };
const LOOK = { skin: { r: .8, g: .6, b: .5 }, hair: { r: .1, g: .1, b: .1 } };
for (const hairNo of [0, 1, 32]) {
  const scene = new Scene(engine);
  const root = new TransformNode("p", scene);
  const b = buildRawVoxelBody(scene, root, {
    name: "t" + hairNo, balance: 50, height: 1.804, weight: 75,
    skin: LOOK.skin, hair: LOOK.hair, hairNo, kit: KIT, jerseyText: "8",
  })!;
  // 髪型は後から読むので少し待つ
  await new Promise((r) => setTimeout(r, 400));
  const names = b.meshes.map((m) => m.name).filter((n) => /hair/.test(n));
  let top = -Infinity;
  for (const m of b.meshes) {
    if (!/hair/.test(m.name)) continue;
    const p = m.getVerticesData("position");
    if (!p) continue;
    for (let i = 0; i < p.length / 3; i++) top = Math.max(top, p[i * 3 + 1]);
  }
  console.log(`髪型No ${String(hairNo).padStart(3)}  髪のメッシュ ${names.length}個: `
    + (names.join(", ") || "なし") + (top > -Infinity ? `  一番上 ${(top * 100).toFixed(1)}cm` : ""));
  b.dispose(); scene.dispose();
}
