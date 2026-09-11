// 自動再生されるアニメーションがボーンのスケールを上書きしているかを再現し、
// 止めれば保たれることを確かめる。⚠️ 描画ループのように**何フレームも**回すこと。
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
const up = skel.bones.find((b) => b.name === "LeftUpLeg")!;
const tn = up.getTransformNode()!;
console.log(`アニメーショングループ ${r.animationGroups.length} 個`);
for (const g of r.animationGroups.slice(0, 3)) {
  console.log(`  ${g.name} / 再生中 ${g.isPlaying} / 対象 ${g.targetedAnimations.length}`);
}
const frames = (n: number): void => { for (let i = 0; i < n; i++) { skel.prepare(true); scene.render(); } };
const snap = (): Float32Array => Float32Array.from(skel.getTransformMatrices(mesh));
const diff = (a: Float32Array, b: Float32Array): number => {
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d;
};
frames(3);
const m0 = snap();

console.log("\n【再現】アニメーションを止めないまま脚を 1.5 倍にして 10 フレーム回す");
tn.scaling = new Vector3(1, 1.5, 1);
skel.prepare(true);
console.log(`  書いた直後        ノードの縦 ${tn.scaling.y.toFixed(3)} / 行列の差 ${diff(m0, snap()).toFixed(3)}`);
frames(10);
console.log(`  10フレーム後      ノードの縦 ${tn.scaling.y.toFixed(3)} / 行列の差 ${diff(m0, snap()).toFixed(3)}`);

console.log("\n【修正】アニメーションを止めてから同じことをする");
for (const g of r.animationGroups) { g.stop(); g.dispose(); }
scene.stopAllAnimations();
tn.scaling = new Vector3(1, 1.5, 1);
skel.prepare(true);
console.log(`  書いた直後        ノードの縦 ${tn.scaling.y.toFixed(3)} / 行列の差 ${diff(m0, snap()).toFixed(3)}`);
frames(10);
console.log(`  10フレーム後      ノードの縦 ${tn.scaling.y.toFixed(3)} / 行列の差 ${diff(m0, snap()).toFixed(3)}`);
