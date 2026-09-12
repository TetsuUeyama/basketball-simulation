// 確認ページと同じ手順（見本に setJaw → 選手を作り直す）で、
// **選手のメッシュ**のあごが変わるかを測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, type Mesh } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};
const { startRawPreload, rawPrototype, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const KIT = { top: { r: 0.1, g: 0.2, b: 0.6 }, bottom: { r: 0.1, g: 0.2, b: 0.6 }, shoes: { r: 1, g: 1, b: 1 } };
const LOOK = { skin: { r: 0.8, g: 0.6, b: 0.5 }, hair: { r: 0.1, g: 0.1, b: 0.1 } };
const H = 1.804, W = 75.2;
const proto = rawPrototype(scene, H, W)!;
/** 頭頂から深さ d の位置での幅(cm)。 */
function jawW(meshes: Mesh[], d: number): number {
  let top = -Infinity;
  for (const m of meshes) {
    const p = m.getVerticesData("position");
    if (!p) continue;
    for (let i = 1; i < p.length; i += 3) if (p[i] > top) top = p[i];
  }
  const z = top - d;
  let lo = 9, hi = -9;
  for (const m of meshes) {
    const p = m.getVerticesData("position");
    if (!p) continue;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i + 1] - z) > 0.010) continue;
      if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i];
    }
  }
  return (hi - lo) * 100;
}
for (const shape of ["normal", "round", "narrow"] as const) {
  proto.setJaw(shape);
  const root = new TransformNode("p_" + shape, scene);
  const b = buildRawVoxelBody(scene, root, {
    name: "t_" + shape, balance: 50, height: H, weight: W,
    skin: LOOK.skin, hair: LOOK.hair, hairNo: 1, kit: KIT, jerseyText: "8",
  })!;
  // ⚠️ body（肌）だけで測る。シャツを入れると 0.22m の位置が襟＝肩幅になり、
  //    あごを測っているつもりで 18.8cm という別物を見ていた。
  // ⚠️ body（肌）だけで測る。シャツを入れると 0.22m の位置が襟＝肩幅になり、
  //    あごを測っているつもりで別物を見ていた。選手側は名前で拾う。
  const pm = (b.meshes as Mesh[]).filter((m) => /body/i.test(m.name) && !/hair/i.test(m.name));
  const gm = (proto.meshes as Mesh[]).filter((m) => /body/i.test(m.name) && !/hair/i.test(m.name));
  console.log("  見本の全メッシュ:", (proto.meshes as Mesh[]).map((m) => m.name + ":" + m.getTotalVertices()).join(" | "));
  console.log("  byPart(body):", (proto as unknown as { byPart: Map<string, Mesh> }).byPart.get("body")?.getTotalVertices());

  if (!pm.length || !gm.length) {
    console.log("  body メッシュが見つからない:", (b.meshes as Mesh[]).map((m) => m.name).join(","));
  }
  console.log(`${shape.padEnd(7)} 見本 0.20m ${jawW(gm, 0.20).toFixed(1)} / 0.22m ${jawW(gm, 0.22).toFixed(1)}`
    + `   選手 0.20m ${jawW(pm, 0.20).toFixed(1)} / 0.22m ${jawW(pm, 0.22).toFixed(1)}cm`);
  b.dispose(); root.dispose();
}
