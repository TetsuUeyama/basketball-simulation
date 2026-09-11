// 髪が出ない件と、目の軸がラベルと合わない件を切り分ける。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, SceneLoader, Vector3, FreeCamera, TransformNode, Quaternion } from "@babylonjs/core";
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
const center = (m: { computeWorldMatrix(f: boolean): unknown; getBoundingInfo(): { boundingBox: { centerWorld: Vector3 } } }): Vector3 => {
  m.computeWorldMatrix(true);
  return m.getBoundingInfo().boundingBox.centerWorld.clone();
};
// ── 目の軸 ──────────────────────────────────────────────
const eyes = body.filter((m) => m.name.startsWith("eyes"));
console.log(`目のメッシュ ${eyes.length} 個 / 親 ${eyes[0]?.parent?.name ?? "なし"}`);
const e = eyes[0];
const base = center(e);
console.log(`  素の位置(ワールド) ${base.x.toFixed(3)}, ${base.y.toFixed(3)}, ${base.z.toFixed(3)}`);
for (const [ax, v] of [["x", new Vector3(0.05, 0, 0)], ["y", new Vector3(0, 0.05, 0)], ["z", new Vector3(0, 0, 0.05)]] as [string, Vector3][]) {
  e.position.copyFrom(v);
  const c = center(e);
  const d = c.subtract(base);
  console.log(`  position.${ax} に +0.05 → ワールドで (${d.x.toFixed(3)}, ${d.y.toFixed(3)}, ${d.z.toFixed(3)})`);
  e.position.setAll(0);
}
// ── 髪 ──────────────────────────────────────────────────
const hr = await grab("hair_low.glb");
const hairs = hr.meshes.filter((m) => m.getTotalVertices() > 0);
for (const m of hr.meshes) m.setEnabled(false);
console.log(`\n髪 ${hairs.length} 個 / 親 ${hairs[0]?.parent?.name ?? "なし"}`);
const hairNode = new TransformNode("hairNode", scene);
hairNode.attachToBone(head, body[0]);
const m = hairs.find((x) => x.name === "Man_Hair_001")!;
m.parent = hairNode;
m.position.set(0, 0, 0);
m.scaling.setAll(1);
m.rotationQuaternion = Quaternion.Identity();
m.setEnabled(true);
scene.render();
console.log(`  付けた後: isEnabled ${m.isEnabled()} / 可視 ${m.isVisible} / 親 ${m.parent?.name}`);
const hc = center(m);
console.log(`  髪の中心(ワールド) ${hc.x.toFixed(3)}, ${hc.y.toFixed(3)}, ${hc.z.toFixed(3)}`);
const hn = hairNode.getAbsolutePosition();
console.log(`  頭ボーンの位置     ${hn.x.toFixed(3)}, ${hn.y.toFixed(3)}, ${hn.z.toFixed(3)}`);
const bb = m.getBoundingInfo().boundingBox;
console.log(`  髪の大きさ 幅 ${(bb.maximumWorld.x - bb.minimumWorld.x).toFixed(3)} 高 ${(bb.maximumWorld.y - bb.minimumWorld.y).toFixed(3)}`);
