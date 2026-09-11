// ページと同じ手順で、髪・目・口が本当に動くかを確かめる（描画ループぶん回す）。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, SceneLoader, Vector3, FreeCamera, TransformNode, Quaternion, type Mesh } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 1, -3), scene);
const grab = async (file: string) => {
  const b64 = readFileSync("public/poly/" + file).toString("base64");
  const r = await SceneLoader.ImportMeshAsync("", "", "data:;base64," + b64, scene, null, ".glb");
  for (const g of r.animationGroups) { g.stop(); g.dispose(); }
  return r;
};
const pr = await grab("player.glb");
scene.stopAllAnimations();
const skel = pr.skeletons[0]!;
let body = pr.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
const head = skel.bones.find((b) => b.name === "Head")!;
// 補正ノード
const headNode = new TransformNode("headNode", scene);
headNode.attachToBone(head, body[0]);
headNode.computeWorldMatrix(true);
const sc = new Vector3(); const rq = new Quaternion(); const tp = new Vector3();
headNode.getWorldMatrix().decompose(sc, rq, tp);
const boneScale = sc.x;
const fix = new TransformNode("hairFix", scene);
fix.parent = headNode;
fix.scaling.setAll(1 / boneScale);
console.log(`骨のスケール ${boneScale.toFixed(5)} → 補正 ${(1 / boneScale).toFixed(1)} 倍`);
// 目
const eyeParts = body.filter((m) => m.name.startsWith("eyes"));
body = body.filter((m) => !eyeParts.includes(m));
for (const m of eyeParts) { m.computeWorldMatrix(true); m.refreshBoundingInfo({ applySkeleton: true }); }
const cy = eyeParts[0].getBoundingInfo().boundingBox.centerWorld.clone();
for (const m of eyeParts) {
  m.applySkeleton(skel); m.skeleton = null; m.parent = null;
  m.position.setAll(0); m.rotationQuaternion = Quaternion.Identity(); m.scaling.setAll(1);
}
eyeParts[0].computeWorldMatrix(true);
eyeParts[0].refreshBoundingInfo({ applySkeleton: false });
const got = eyeParts[0].getBoundingInfo().boundingBox.centerWorld;
const eyeBase = new Vector3(cy.x - got.x, cy.y - got.y, cy.z - got.z);
headNode.computeWorldMatrix(true);
const hp0 = headNode.getAbsolutePosition();
const eyeRest = hp0.clone();
const wc = (m: Mesh): Vector3 => {
  m.computeWorldMatrix(true); m.refreshBoundingInfo({ applySkeleton: false });
  return m.getBoundingInfo().boundingBox.centerWorld.clone();
};
const applyEyes = (x: number, y: number, z: number): void => {
  headNode.computeWorldMatrix(true);
  const hp = headNode.getAbsolutePosition();
  for (const m of eyeParts) m.position.set(eyeBase.x + hp.x - eyeRest.x + x, eyeBase.y + hp.y - eyeRest.y + y, eyeBase.z + hp.z - eyeRest.z + z);
};
applyEyes(0, 0, 0);
for (let i = 0; i < 10; i++) scene.render();
const e0 = wc(eyeParts[0]);
console.log(`\n目: 素の位置 y ${e0.y.toFixed(3)}（狙い ${cy.y.toFixed(3)}）`);
for (const [lb, x, y, z] of [["左右 +2cm", 0.02, 0, 0], ["上下 +2cm", 0, 0.02, 0], ["前後 +2cm", 0, 0, 0.02]] as [string, number, number, number][]) {
  applyEyes(x, y, z);
  for (let i = 0; i < 10; i++) scene.render();
  const d = wc(eyeParts[0]).subtract(e0);
  console.log(`  ${lb} → ワールド (${(d.x * 100).toFixed(1)}, ${(d.y * 100).toFixed(1)}, ${(d.z * 100).toFixed(1)}) cm`);
}
applyEyes(0, 0, 0);
// 髪
const hr = await grab("hair_low.glb");
const hairs = hr.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
for (const m of hr.meshes) m.setEnabled(false);
const h = hairs.find((x) => x.name === "Man_Hair_001")!;
h.parent = fix; h.position.setAll(0); h.scaling.setAll(1);
h.rotationQuaternion = Quaternion.Identity(); h.setEnabled(true);
for (let i = 0; i < 10; i++) scene.render();
h.computeWorldMatrix(true); h.refreshBoundingInfo({ applySkeleton: false });
let bb = h.getBoundingInfo().boundingBox;
const w0 = bb.maximumWorld.x - bb.minimumWorld.x;
const fit = 0.19 / w0;
h.scaling.setAll(fit);
for (let i = 0; i < 10; i++) scene.render();
h.computeWorldMatrix(true); h.refreshBoundingInfo({ applySkeleton: false });
bb = h.getBoundingInfo().boundingBox;
console.log(`\n髪: 付けた直後の幅 ${w0.toFixed(3)}m → 倍率 ${fit.toFixed(2)} → ${(bb.maximumWorld.x - bb.minimumWorld.x).toFixed(3)}m`);
console.log(`  表示 ${h.isEnabled()} / 中心 y ${bb.centerWorld.y.toFixed(3)}（頭ボーン ${headNode.getAbsolutePosition().y.toFixed(3)}）`);
