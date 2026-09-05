// 背番号の板が、選手ごとの番号で、ジャージの背面のすぐ外に載っているかを見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, type Mesh } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
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
const KIT = { top: { r: .1, g: .25, b: .6 }, bottom: { r: .1, g: .25, b: .6 }, shoes: { r: 1, g: 1, b: 1 } };
const b = buildRawVoxelBody(scene, new TransformNode("t", scene), {
  name: "n", balance: 50, height: 1.8, weight: 75, skin: { r: .8, g: .6, b: .5 },
  hair: { r: .1, g: .1, b: .1 }, hairNo: 0, kit: KIT, jerseyText: "23",
})!;

/** 素体の座標系（root ローカル）で測る。 */
function local(m: Mesh): { x: [number, number]; y: [number, number]; z: [number, number] } {
  m.computeWorldMatrix(true); m.refreshBoundingInfo();
  const bb = m.getBoundingInfo().boundingBox;
  return { x: [bb.minimumWorld.x, bb.maximumWorld.x], y: [bb.minimumWorld.y, bb.maximumWorld.y],
    z: [bb.minimumWorld.z, bb.maximumWorld.z] };
}
const mark = b.meshes.find((m) => m.name.startsWith("jerseymark_")) as Mesh;
const jersey = b.meshes.find((m) => m.name.startsWith("jersey_")) as Mesh;
const panel = scene.meshes.find((m) => m.name.startsWith("rawnumshell_")) as Mesh;
const f = (r: [number, number]) => `${r[0].toFixed(3)}〜${r[1].toFixed(3)}`;
console.log("jerseymark（残った前面のエンブレム類） Z", f(local(mark).z), "  三角形", mark.getTotalIndices() / 3);
console.log("番号の板                            Z", f(local(panel).z), " Y", f(local(panel).y), " X", f(local(panel).x));
console.log("ジャージ全体                        Z", f(local(jersey).z));

// 板がジャージの背面より外にあるか、番号の高さ帯で確かめる
const pj = jersey.getVerticesData("position")!;
const py = local(panel).y, px = local(panel).x;
let zJersey = 0;
for (let i = 0; i < pj.length / 3; i++) {
  const x = pj[i * 3], y = pj[i * 3 + 1], z = pj[i * 3 + 2];
  if (y < py[0] || y > py[1] || x < px[0] || x > px[1]) continue;
  if (z < zJersey) zJersey = z;
}
const zPanel = local(panel).z[0];
console.log(`\n番号帯でのジャージ背面の一番後ろ ${zJersey.toFixed(4)} / 板の一番後ろ ${zPanel.toFixed(4)}`
  + `  → 板は ${((zJersey - zPanel) * 1000).toFixed(1)}mm 外側 ${zPanel < zJersey ? "OK" : "★めり込んでいる"}`);

// 背番号の差し替え（headless の canvas は偽物なので、描けた文字は見られない）
console.log("");
console.log("背番号の差し替え:");
for (const t of ["23", "7", "R"]) {
  b.setJerseyText(t, "white");
  console.log(`  setJerseyText("${t}") → 例外なし`);
}
