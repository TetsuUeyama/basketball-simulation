// 胴の半幅（腰まわり）と肩の位置を測る。腕を真下へ垂らして胴に当たるかを見る。
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
for (const kg of [60, 75, 95]) {
  const vb = buildRawVoxelBody(scene, new TransformNode("r" + kg, scene), {
    name: "r" + kg, balance: 50, height: 1.804, weight: kg, skin: { r: .8, g: .6, b: .5 },
    hair: { r: .1, g: .1, b: .1 }, hairNo: 0, kit: { top: { r: .8, g: .1, b: .1 },
    bottom: { r: .8, g: .1, b: .1 }, shoes: { r: 1, g: 1, b: 1 } }, jerseyText: "8" })!;
  const shorts = vb.meshes.find((m) => m.name.startsWith("shorts_")) as Mesh;
  const p = shorts.getVerticesData("position")!;
  let xmax = -Infinity, ytop = -Infinity;
  for (let i = 0; i < p.length / 3; i++) ytop = Math.max(ytop, p[i * 3 + 1]);
  for (let i = 0; i < p.length / 3; i++) {
    if (p[i * 3 + 1] < ytop - 0.06) continue;      // ショーツの一番上＝腰
    if (p[i * 3] > xmax) xmax = p[i * 3];
  }
  const sh = vb.shoulder.x;
  const need = xmax - Math.abs(sh);
  const deg = Math.atan2(Math.max(0, need), vb.upperArm) * 180 / Math.PI;
  console.log(`${kg}kg  肩 x=${Math.abs(sh).toFixed(3)}  胴(腰)の半幅 ${xmax.toFixed(3)}`
    + `  → はみ出し ${(need * 1000).toFixed(0)}mm  必要な開き ${deg.toFixed(1)}°`);
  vb.dispose();
}
