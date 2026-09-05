// 肩のボーンが、実際の肩の肉に対してどこに立っているかを測る。
// 腕の付け根の関節は、三角筋の表面より内側にあるのが自然。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, type Mesh } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const vb = buildRawVoxelBody(scene, new TransformNode("r", scene), {
  name: "r", balance: 50, height: 1.8, weight: 75, skin: { r: .8, g: .6, b: .5 },
  hair: { r: .1, g: .1, b: .1 }, hairNo: 0, kit: { top: { r: .8, g: .1, b: .1 },
  bottom: { r: .8, g: .1, b: .1 }, shoes: { r: 1, g: 1, b: 1 } }, jerseyText: "8" })!;
const sh = vb.rig.restPosition("LeftUpperArm" as never)!;
const k = 1;
console.log(`肩のボーン: x=${sh.x.toFixed(3)} y=${sh.y.toFixed(3)}  （左右で ${(Math.abs(sh.x) * 200).toFixed(1)}cm 開いている）`);

// 肩の高さの帯で、体（服）が左右にどこまであるか
const jersey = vb.meshes.find((m) => m.name.startsWith("jersey_")) as Mesh;
jersey.computeWorldMatrix(true);
const p = jersey.getVerticesData("position")!;
for (const [lo, hi, label] of [[sh.y - 0.02, sh.y + 0.02, "肩のボーンの高さ"],
  [sh.y + 0.04, sh.y + 0.09, "その少し上（肩の頂点）"]] as [number, number, string][]) {
  let xmax = -Infinity;
  for (let i = 0; i < p.length / 3; i++) {
    const y = p[i * 3 + 1];
    if (y < lo || y > hi) continue;
    if (Math.abs(p[i * 3 + 2]) > 0.08) continue;
    if (p[i * 3] > xmax) xmax = p[i * 3];
  }
  console.log(`${label.padEnd(24)} 服の外側 x=${xmax.toFixed(3)}  （幅 ${(xmax * 200).toFixed(1)}cm）`
    + `  ボーンは表面より ${((xmax - Math.abs(sh.x)) * 1000 * k).toFixed(0)}mm 内側`);
}
