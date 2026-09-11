// シェーダが実際に見るボーン行列が変わるかを直接比べる。
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
const snap = (): Float32Array => Float32Array.from(skel.getTransformMatrices(mesh));
const diff = (a: Float32Array, b: Float32Array): number => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
};
scene.render();
const m0 = snap();

// (1) ノードへ書くだけ（今のページの動き）
tn.scaling = new Vector3(1, 1.5, 1);
scene.render();
console.log(`(1) ノードへ書くだけ            行列の最大差 ${diff(m0, snap()).toFixed(4)}`);

// (2) ノードへ書いて bone.markAsDirty()
tn.scaling = new Vector3(1, 1.8, 1);
up.markAsDirty();
scene.render();
console.log(`(2) + bone.markAsDirty()        行列の最大差 ${diff(m0, snap()).toFixed(4)}`);

// (3) ノードへ書いて skeleton.prepare(true)
tn.scaling = new Vector3(1, 2.2, 1);
skel.prepare(true);
console.log(`(3) + skeleton.prepare(true)    行列の最大差 ${diff(m0, snap()).toFixed(4)}`);

// (4) _isDirty を立ててから prepare
tn.scaling = new Vector3(1, 2.6, 1);
(skel as unknown as { _isDirty: boolean })._isDirty = true;
skel.prepare(true);
console.log(`(4) _isDirty=true + prepare     行列の最大差 ${diff(m0, snap()).toFixed(4)}`);
console.log(`\nneedInitialSkinMatrix = ${(skel as unknown as { needInitialSkinMatrix: boolean }).needInitialSkinMatrix}`);
