// どこで止まっているのかを切り分ける: ノード → ボーン行列 → メッシュの境界。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, SceneLoader, Vector3, FreeCamera, Matrix } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
const engine = new NullEngine();
const scene = new Scene(engine);
new FreeCamera("c", new Vector3(0, 1, -3), scene);
const b64 = readFileSync("public/poly/player.glb").toString("base64");
const r = await SceneLoader.ImportMeshAsync("", "", "data:;base64," + b64, scene, null, ".glb");
const skel = r.skeletons[0]!;
const mesh = r.meshes.find((m) => m.getTotalVertices() > 0)!;
const find = (n: string) => skel.bones.find((b) => b.name === n)!;
const up = find("LeftUpLeg"), foot = find("LeftFoot");
const tn = up.getTransformNode();
console.log(`LeftUpLeg のノード: ${tn ? tn.name : "無し"} / scaling ${tn ? tn.scaling.toString() : "-"}`);

const boneWorld = (b: typeof foot): Vector3 => {
  skel.prepare(true);
  mesh.computeWorldMatrix(true);
  const m = b.getFinalMatrix().multiply(mesh.getWorldMatrix());
  return m.getTranslation();
};
const p0 = boneWorld(foot);
console.log(`足のボーン位置 (素)              ${p0.y.toFixed(4)}`);

if (tn) { tn.scaling = new Vector3(1, 2.0, 1); tn.computeWorldMatrix(true); }
const p1 = boneWorld(foot);
console.log(`ノードを y2.0 倍              ${p1.y.toFixed(4)}  差 ${(p1.y - p0.y).toFixed(4)}`);

if (tn) { tn.scaling = new Vector3(1, 1, 1); tn.computeWorldMatrix(true); }
up.setScale(new Vector3(1, 2.0, 1));
const p2 = boneWorld(foot);
console.log(`bone.setScale で y2.0 倍      ${p2.y.toFixed(4)}  差 ${(p2.y - p0.y).toFixed(4)}`);

// ボーンのローカル行列そのものを直接書き換えたら?
up.setScale(new Vector3(1, 1, 1));
const lm = up.getLocalMatrix().clone();
const scaled = Matrix.Scaling(1, 2.0, 1).multiply(lm);
up.getLocalMatrix().copyFrom(scaled);
up.markAsDirty();
const p3 = boneWorld(foot);
console.log(`ローカル行列を直接 y2.0 倍    ${p3.y.toFixed(4)}  差 ${(p3.y - p0.y).toFixed(4)}`);
console.log(`\nスケルトンの needInitialSkinMatrix: ${(skel as unknown as { needInitialSkinMatrix: boolean }).needInitialSkinMatrix}`);
