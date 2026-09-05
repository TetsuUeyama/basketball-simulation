// 身長を変えたときに、実際の見た目の高さと頭の大きさがどうなるかを測る。
// ⚠️ GPU スキニングなので頂点は CPU 側で動かない。ボーンのワールド位置と
//    ノードの拡大率から、実際に描かれる高さを組み立てて確かめる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";

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
const { buildRawModel } = await import("../src/voxraw");

const engine = new NullEngine();
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");
console.log(`モデル自身の身長 ${m.modelHeightCm.toFixed(1)}cm`);

const worldY = (b: string): number => {
  const n = m.rig.node(b as never);
  if (!n) return NaN;
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition().y;
};
/** body メッシュの素の高さ（rest 空間）。頭頂と足元を出すのに使う。 */
let rawTop = -Infinity, rawBottom = Infinity;
for (const [name, mesh] of m.byPart) {
  if (name.startsWith("hairstyle_")) continue;
  const q = mesh.getVerticesData("position")!;
  for (let i = 0; i < q.length / 3; i++) {
    const y = q[i * 3 + 1];
    if (name === "body" && y > rawTop) rawTop = y;   // 頭頂は body で測る
    if (y < rawBottom) rawBottom = y;                 // 足元は全部位で測る
  }
}
const headNode = m.rig.node("Head" as never)!;
const headRestY = (() => {
  m.root.scaling.setAll(1);
  headNode.scaling.setAll(1);
  return worldY("Head");
})();
const crownAboveHead = rawTop - headRestY;      // 頭のボーンから頭頂まで（素の寸法）

console.log("\n指定身長  全体の倍率  頭の倍率  頭のボーン高さ   頭頂の高さ   頭の大きさ");
for (const cm of [158, 170, 180.4, 190, 203]) {
  m.setHeight(cm);
  m.root.computeWorldMatrix(true);
  const k = m.root.scaling.x;
  const hk = k * headNode.scaling.x;            // 頭の最終倍率
  const hy = worldY("Head");
  const crown = hy + crownAboveHead * hk;
  console.log(`  ${cm.toFixed(1).padStart(6)}cm   x${k.toFixed(3)}    x${hk.toFixed(3)}`
    + `   ${hy.toFixed(3)}m      ${crown.toFixed(3)}m    ${(crownAboveHead * hk * 100).toFixed(1)}cm`);
}

// 足元が地面に残っているか
m.setHeight(203);
m.root.computeWorldMatrix(true);
const k = m.root.scaling.x;
console.log(`\n足元（body の最下端 ${rawBottom.toFixed(3)}m）は 203cm 指定で ${(rawBottom * k).toFixed(4)}m`
  + `  ${Math.abs(rawBottom * k) < 0.02 ? "OK（地面に残る）" : "★地面から離れる"}`);
console.log(`肩幅など体の横幅も x${k.toFixed(3)} で伸びる（一様拡大）`);
