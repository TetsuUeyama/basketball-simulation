// 目と髪の直し方を実測で決める。
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
const body = pr.meshes.filter((m) => m.getTotalVertices() > 0);
const head = skel.bones.find((b) => b.name === "Head")!;
const wbox = (m: Mesh, skin: boolean) => {
  m.computeWorldMatrix(true);
  m.refreshBoundingInfo({ applySkeleton: skin });
  const bb = m.getBoundingInfo().boundingBox;
  return { c: bb.centerWorld.clone(), w: bb.maximumWorld.x - bb.minimumWorld.x };
};
const eyes = body.filter((m) => m.name.startsWith("eyes")) as Mesh[];
console.log("【目】");
for (const e of eyes) {
  const a = wbox(e, true), b = wbox(e, false);
  console.log(`  ${e.name}: スキン有り 中心y ${a.c.y.toFixed(3)} 幅 ${a.w.toFixed(3)}`
    + ` / スキン無し 中心y ${b.c.y.toFixed(3)} 幅 ${b.w.toFixed(3)}`);
}
// applySkeleton で焼き込んでからスケルトンを外す
const faceNode = new TransformNode("faceNode", scene);
faceNode.attachToBone(head, body[0]);
scene.render();
console.log(`  頭ボーンの位置 ${faceNode.getAbsolutePosition().y.toFixed(3)}`);
for (const e of eyes) {
  e.applySkeleton(skel);          // 今の見た目を頂点へ焼き込む
  e.skeleton = null;              // 以後はふつうのメッシュとして扱う
  e.parent = faceNode;
  e.position.setAll(0);
  e.rotationQuaternion = Quaternion.Identity();
}
scene.render();
const before = wbox(eyes[0], false);
console.log(`  焼き込み後の中心y ${before.c.y.toFixed(3)}`);
for (const [ax, v] of [["x", new Vector3(0.05, 0, 0)], ["y", new Vector3(0, 0.05, 0)], ["z", new Vector3(0, 0, 0.05)]] as [string, Vector3][]) {
  eyes[0].position.copyFrom(v);
  const c = wbox(eyes[0], false).c.subtract(before.c);
  console.log(`  position.${ax} に +0.05 → ワールド (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)})`);
  eyes[0].position.setAll(0);
}
console.log("\n【髪】");
const hr = await grab("hair_low.glb");
const hairs = hr.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
const m = hairs.find((x) => x.name === "Man_Hair_001")!;
const b0 = wbox(m, false);
console.log(`  親 __root__ のまま: 幅 ${b0.w.toFixed(4)}m`);
const hairNode = new TransformNode("hairNode", scene);
hairNode.attachToBone(head, body[0]);
m.parent = hairNode;
m.position.setAll(0); m.scaling.setAll(1); m.rotationQuaternion = Quaternion.Identity();
scene.render();
const b1 = wbox(m, false);
console.log(`  頭ボーンへ付けた後: 幅 ${b1.w.toFixed(4)}m → ${(b0.w / b1.w).toFixed(1)} 分の1に縮んだ`);
const hs = (head.getTransformNode()?.scaling ?? new Vector3(1, 1, 1));
console.log(`  Head ノードの scaling ${hs.x.toFixed(3)}, ${hs.y.toFixed(3)}, ${hs.z.toFixed(3)}`);
console.log(`  hairNode の scaling   ${hairNode.scaling.x.toFixed(4)}, ${hairNode.scaling.y.toFixed(4)}, ${hairNode.scaling.z.toFixed(4)}`);
// 実測から必要な倍率を出して当てる
const want = 0.19;
m.scaling.setAll(want / b1.w);
scene.render();
console.log(`  幅 ${want}m を狙って倍率 ${(want / b1.w).toFixed(1)} → 実測 ${wbox(m, false).w.toFixed(3)}m`);
