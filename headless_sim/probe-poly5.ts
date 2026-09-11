// poly.ts の applyBody と同じ手順で、シェーダが見る行列まで本当に届くか。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, SceneLoader, Vector3, FreeCamera } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 1, -3), scene);
const b64 = readFileSync("public/poly/player.glb").toString("base64");
const r = await SceneLoader.ImportMeshAsync("", "", "data:;base64," + b64, scene, null, ".glb");
const skel = r.skeletons[0]!;
const mesh = r.meshes.find((m) => m.getTotalVertices() > 0)!;
const bone = (n: string) => skel.bones.find((b) => b.name === n);
const rest = new Map<string, Vector3>();
const setBone = (name: string, x: number, y: number, z: number): void => {
  const b = bone(name); if (!b) return;
  const tn = b.getTransformNode();
  if (!rest.has(name)) rest.set(name, (tn ? tn.scaling : b.getScale()).clone());
  const q = rest.get(name)!;
  const next = new Vector3(q.x * x, q.y * y, q.z * z);
  if (tn) { tn.scaling.copyFrom(next); tn.computeWorldMatrix(true); } else b.setScale(next);
};
const LEG = ["LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"];
const applyBody = (legLen: number, spineLen: number, thick: number, hs: number): void => {
  for (const n of LEG) setBone(n, thick, legLen, thick);
  setBone("Spine", thick, spineLen, thick);
  setBone("Hips", thick, 1, thick);
  setBone("Head", hs, hs, hs);
  skel.prepare(true);   // ← poly.ts と同じ
};
const snap = (): Float32Array => Float32Array.from(skel.getTransformMatrices(mesh));
const diff = (a: Float32Array, b: Float32Array): number => {
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d;
};
applyBody(1, 1, 1, 1);
const m0 = snap();
for (const [l, sp, th, hs, label] of [
  [1.2, 1, 1, 1, "脚 1.20倍"], [1, 1.2, 1, 1, "胴 1.20倍"],
  [1, 1, 1.3, 1, "太さ 1.30倍"], [1, 1, 1, 1.25, "頭 1.25倍"], [0.85, 1, 1, 1, "脚 0.85倍"],
] as [number, number, number, number, string][]) {
  applyBody(l, sp, th, hs);
  console.log(`${label.padEnd(12)} シェーダが見る行列の最大差 ${diff(m0, snap()).toFixed(3)}`);
}
applyBody(1, 1, 1, 1);
console.log(`素へ戻す     差 ${diff(m0, snap()).toFixed(3)}（0 に戻れば掛け算で溜まっていない）`);
