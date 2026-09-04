// 確認ページが呼ぶ buildRawModel() を**そのまま**動かして、メッシュが本当にできるか見る。
// fetch を public/ 配下のファイル読みに差し替えて、ブラウザと同じコードを通す。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";

const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () => ab,
    };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};

const { buildRawModel } = await import("../src/voxraw");
const { motionClip, motionDuration, applyMotion } = await import("../vendor/objcts/player/motion/clip");

const engine = new NullEngine();
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");

console.log(`メッシュ ${m.meshes.length} / ボクセル ${m.voxelCount.toLocaleString()} / 三角形 ${m.triangles.toLocaleString()}`);
let bad = 0;
for (const mesh of m.meshes) {
  const v = mesh.getTotalVertices(), i = mesh.getTotalIndices();
  const hasW = !!mesh.getVerticesData("matricesWeights");
  const hasC = !!mesh.getVerticesData("color");
  if (!v || !i || !hasW || !hasC || !mesh.skeleton) bad++;
  console.log(`  ${mesh.name.padEnd(14)} 頂点 ${String(v).padStart(7)} 索引 ${String(i).padStart(7)}`
    + ` weights=${hasW ? "有" : "★無"} color=${hasC ? "有" : "★無"} skeleton=${mesh.skeleton ? "有" : "★無"}`);
}
console.log(`  骨 ${m.skel.bones.length} 本 / 問題のあるメッシュ ${bad}`);

// モーションで頂点が実際に動くか（スキニング後の位置で確認）
const clip = motionClip(process.env.CLIP ?? "dribbleRun")!;
const dur = motionDuration(clip);
const mesh = m.meshes.find((x) => x.name.includes("body"))!;
const sample = (t: number): Vector3[] => {
  applyMotion(m.rig, clip, t, { rootMotion: "vertical", leanDeg: 0 });
  m.root.computeWorldMatrix(true);
  m.skel.prepare(true);
  mesh.computeWorldMatrix(true);
  const pos = mesh.getVerticesData("position")!;
  const out: Vector3[] = [];
  for (const i of [0, 1000, 5000, 20000]) {
    if (i * 3 + 2 < pos.length) out.push(Vector3.TransformCoordinates(new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), mesh.getWorldMatrix()));
  }
  return out;
};
const a = sample(0), b = sample(dur * 0.5);
console.log(`\n※ 頂点位置は CPU 側では動かない（GPU スキニング）。骨の動きで確認する:`);
for (const bn of ["LeftHand", "RightFoot", "Head"]) {
  const bone = m.skel.bones.find((x) => x.name === bn);
  if (!bone) { console.log(`  ${bn}: 骨が無い`); continue; }
  applyMotion(m.rig, clip, 0, { rootMotion: "vertical", leanDeg: 0 }); m.skel.prepare(true);
  const p0 = bone.getFinalMatrix().getTranslation().clone();
  applyMotion(m.rig, clip, dur * 0.5, { rootMotion: "vertical", leanDeg: 0 }); m.skel.prepare(true);
  const p1 = bone.getFinalMatrix().getTranslation();
  console.log(`  ${bn.padEnd(10)} 骨の移動 ${(Vector3.Distance(p0, p1) * 100).toFixed(1)}cm`);
}
void a; void b;
