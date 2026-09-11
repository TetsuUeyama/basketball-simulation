// poly.ts と同じ手順で、体型・目・髪が実際に動くかを確かめる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, SceneLoader, Vector3, FreeCamera, type Bone, type TransformNode } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 1, -3), scene);
const load = async (file: string) => {
  const b64 = readFileSync("public/poly/" + file).toString("base64");
  return SceneLoader.ImportMeshAsync("", "", "data:;base64," + b64, scene, null, ".glb");
};
const r = await load("player.glb");
const skel = r.skeletons[0]!;
const meshes = r.meshes.filter((m) => m.getTotalVertices() > 0);
const bone = (n: string): Bone | undefined => skel.bones.find((b) => b.name === n);
const boneY = (n: string): number => {
  skel.prepare(true);
  meshes[0].computeWorldMatrix(true);
  const b = bone(n);
  return b ? b.getAbsolutePosition(meshes[0] as unknown as TransformNode).y : 0;
};
let lo = Infinity, hi = -Infinity;
for (const m of meshes) {
  m.computeWorldMatrix(true); m.refreshBoundingInfo({ applySkeleton: true });
  const bb = m.getBoundingInfo().boundingBox;
  lo = Math.min(lo, bb.minimumWorld.y); hi = Math.max(hi, bb.maximumWorld.y);
}
const crownGap = hi - boneY("Head");
const soleGap = Math.min(boneY("LeftFoot"), boneY("RightFoot")) - lo;
let headSize = 1;
const height = (): number =>
  (boneY("Head") + crownGap * headSize) - (Math.min(boneY("LeftFoot"), boneY("RightFoot")) - soleGap);

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
const apply = (legLen: number, spineLen: number, thick: number, hs: number): void => {
  headSize = hs;
  for (const n of LEG) setBone(n, thick, legLen, thick);
  setBone("Spine", thick, spineLen, thick);
  setBone("Hips", thick, 1, thick);
  setBone("Head", hs, hs, hs);
};
console.log(`ボーン ${skel.bones.length} 本 / ノード連動 ${skel.bones.filter((b) => !!b.getTransformNode()).length} 本`);
apply(1, 1, 1, 1);
console.log(`  素の値: 箱 ${lo.toFixed(3)}〜${hi.toFixed(3)} / Head骨 ${boneY("Head").toFixed(3)} / LeftFoot骨 ${boneY("LeftFoot").toFixed(3)} / crownGap ${crownGap.toFixed(3)} soleGap ${soleGap.toFixed(3)}`);
console.log(`素            身長 ${(height() * 100).toFixed(1)}cm`);
apply(1.2, 1, 1, 1);
console.log(`脚 1.20倍     身長 ${(height() * 100).toFixed(1)}cm`);
apply(1, 1.2, 1, 1);
console.log(`胴 1.20倍     身長 ${(height() * 100).toFixed(1)}cm`);
apply(0.85, 1, 1, 1);
console.log(`脚 0.85倍     身長 ${(height() * 100).toFixed(1)}cm`);
apply(1, 1, 1, 1.25);
console.log(`頭 1.25倍     身長 ${(height() * 100).toFixed(1)}cm`);
apply(1, 1, 1, 1);
// 目
const eyeParts = meshes.filter((m) => m.name === "eyes" || m.name.startsWith("eyes_primitive"));
console.log(`\n目のメッシュ ${eyeParts.length} 個: ${eyeParts.map((m) => m.name).join(", ")}`);
// 髪
for (const file of ["hair_low.glb"]) {
  const hr = await load(file);
  const names = hr.meshes.filter((m) => m.getTotalVertices() > 0).map((m) => m.name);
  const pick = "Man_Hair_001";
  const found = names.find((n) => n === pick || n.startsWith(pick + "_primitive"));
  console.log(`${file}: ${names.length} 個 / "${pick}" は ${found ? "見つかる○ (" + found + ")" : "見つからない×"}`);
  console.log(`  名前 ${names.slice(0, 4).join(", ")}`);
}
