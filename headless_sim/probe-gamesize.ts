// ゲームで使う「焼き込みモデル」と「生モデル」を同じ身長で組み、実際に描かれる高さを比べる。
// ⚠️ 頂点は GPU スキニング前の rest 空間だが、素体はどちらも rest で組むのでそのまま比べられる。
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
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};
const { buildVoxelBody } = await import("../src/objects/player/player-voxel");
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();

const engine = new NullEngine();
const KIT = { top: { r: 0.8, g: 0.1, b: 0.1 }, bottom: { r: 0.8, g: 0.1, b: 0.1 }, shoes: { r: 1, g: 1, b: 1 } };
const LOOK = { skin: { r: 0.8, g: 0.6, b: 0.5 }, hair: { r: 0.1, g: 0.1, b: 0.1 } };

/**
 * メッシュ群のワールドでの高さ。
 * ⚠️ 焼き込みモデルはメッシュを**ボーンに親子付け**しているので、頂点のローカル座標では
 *    比較にならない（実測で足元が -0.345m になり、原点が違うように見えた）。
 *    ワールドの境界箱で測ること。
 */
function extentWorld(meshes: { computeWorldMatrix(f: boolean): unknown;
  refreshBoundingInfo(): unknown;
  getBoundingInfo(): { boundingBox: { minimumWorld: { y: number }; maximumWorld: { y: number } } } }[],
): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo();
    const bb = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, bb.minimumWorld.y);
    hi = Math.max(hi, bb.maximumWorld.y);
  }
  return { lo, hi };
}
console.log("身長   焼き込みモデル(足元〜頭頂)      生モデル(足元〜頭頂)");
for (const h of [1.70, 1.804, 1.98]) {
  const s1 = new Scene(engine);
  const p1 = new TransformNode("p1", s1);
  const baked = buildVoxelBody(s1, p1, {
    name: "baked", balance: 50, height: h, skin: LOOK.skin, hair: LOOK.hair,
    hairNo: 1, kit: KIT, jerseyText: "8",
  });
  p1.computeWorldMatrix(true);
  const e1 = extentWorld(baked.meshes as never);

  const s2 = new Scene(engine);
  const p2 = new TransformNode("p2", s2);
  const rawB = buildRawVoxelBody(s2, p2, {
    name: "raw", balance: 50, height: h, weight: 23.1 * h * h, skin: LOOK.skin, hair: LOOK.hair,
    hairNo: 1, kit: KIT, jerseyText: "8",
  });
  if (!rawB) { console.log("  生モデルが組めない"); break; }
  p2.computeWorldMatrix(true);
  const e2 = extentWorld(rawB.meshes as never);
  const k = 1;

  console.log(`${(h * 100).toFixed(1)}cm  ${e1.lo.toFixed(3)}〜${e1.hi.toFixed(3)} (高さ ${((e1.hi - e1.lo) * 100).toFixed(1)}cm)`
    + `   ${e2.lo.toFixed(3)}〜${e2.hi.toFixed(3)} (高さ ${((e2.hi - e2.lo) * 100).toFixed(1)}cm) / 倍率 ${k.toFixed(3)}`);
  baked.dispose(); rawB.dispose();
  s1.dispose(); s2.dispose();
}
