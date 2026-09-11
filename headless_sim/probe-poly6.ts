// 「描かれる頂点」が実際に動くかを、CPU でスキニングを手計算して確かめる。
// ⚠️ 行列が変わることと、絵が変わることは別。頂点まで追う。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, SceneLoader, Vector3, FreeCamera, Matrix, VertexBuffer } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 1, -3), scene);
const b64 = readFileSync("public/poly/player.glb").toString("base64");
const r = await SceneLoader.ImportMeshAsync("", "", "data:;base64," + b64, scene, null, ".glb");
const skel = r.skeletons[0]!;
const mesh = r.meshes.filter((m) => m.getTotalVertices() > 0)
  .sort((a, b) => b.getTotalVertices() - a.getTotalVertices())[0];
const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
const mi = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
const mw = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!;
console.log(`対象メッシュ ${mesh.name} / 頂点 ${pos.length / 3}`);

/** シェーダと同じ式で頂点を変形する（4本のボーンの重み付き和）。 */
function skinned(): Float32Array {
  const m = skel.getTransformMatrices(mesh);
  const out = new Float32Array(pos.length);
  const tmp = new Matrix();
  const acc = new Matrix();
  for (let v = 0; v < pos.length / 3; v++) {
    acc.copyFrom(Matrix.Zero());
    for (let k = 0; k < 4; k++) {
      const w = mw[v * 4 + k];
      if (w === 0) continue;
      Matrix.FromArrayToRef(m as unknown as number[], mi[v * 4 + k] * 16, tmp);
      for (let i = 0; i < 16; i++) acc.m[i] += tmp.m[i] * w;
      acc.markAsUpdated();
    }
    const p = new Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    const q = Vector3.TransformCoordinates(p, acc);
    out[v * 3] = q.x; out[v * 3 + 1] = q.y; out[v * 3 + 2] = q.z;
  }
  return out;
}
const rest = new Map<string, Vector3>();
const setBone = (name: string, x: number, y: number, z: number): void => {
  const b = skel.bones.find((bb) => bb.name === name); if (!b) return;
  const tn = b.getTransformNode();
  if (!rest.has(name)) rest.set(name, (tn ? tn.scaling : b.getScale()).clone());
  const q = rest.get(name)!;
  const next = new Vector3(q.x * x, q.y * y, q.z * z);
  if (tn) { tn.scaling.copyFrom(next); tn.computeWorldMatrix(true); } else b.setScale(next);
};
const LEG = ["LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"];
const apply = (leg: number, thick: number): void => {
  for (const n of LEG) setBone(n, thick, leg, thick);
  setBone("Spine", thick, 1, thick);
  setBone("Hips", thick, 1, thick);
  skel.prepare(true);
};
const span = (a: Float32Array): { lo: number; hi: number } => {
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < a.length / 3; v++) { const y = a[v * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
  return { lo, hi };
};
apply(1, 1);
const v0 = skinned();
const s0 = span(v0);
console.log(`素          頂点の高さ ${s0.lo.toFixed(3)}〜${s0.hi.toFixed(3)} (差 ${(s0.hi - s0.lo).toFixed(3)}m)`);
for (const [leg, thick, label] of [[1.2, 1, "脚 1.20倍"], [0.85, 1, "脚 0.85倍"], [1, 1.3, "太さ 1.30倍"]] as [number, number, string][]) {
  apply(leg, thick);
  const v1 = skinned();
  let moved = 0, maxd = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const d = Math.hypot(v1[v * 3] - v0[v * 3], v1[v * 3 + 1] - v0[v * 3 + 1], v1[v * 3 + 2] - v0[v * 3 + 2]);
    if (d > 0.001) moved++;
    if (d > maxd) maxd = d;
  }
  const s1 = span(v1);
  console.log(`${label.padEnd(11)} 頂点の高さ ${s1.lo.toFixed(3)}〜${s1.hi.toFixed(3)} (差 ${(s1.hi - s1.lo).toFixed(3)}m)`
    + ` / 動いた頂点 ${(moved / (pos.length / 3) * 100).toFixed(0)}% 最大 ${(maxd * 100).toFixed(1)}cm`);
}
