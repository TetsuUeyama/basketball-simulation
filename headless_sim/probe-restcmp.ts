// ゲームが使う焼き込みモデルの rest 姿勢と、生モデルの rest 姿勢を比べる。
// 腕の向きが違うと、同じ回転を入れても見た目がずれる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { bodyRestPose } = await import("../vendor/objcts/player/voxel/voxelBody");
const { buildRig } = await import("../vendor/objcts/player/rig");
const { buildRawModel } = await import("../src/voxraw");

const engine = new NullEngine();
const down = (a: Vector3, b: Vector3): number => {
  const d = b.subtract(a);
  return (Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI;
};

for (const v of ["skinny", "normal", "muscle"] as const) {
  const scene = new Scene(engine);
  const rest = bodyRestPose(v, 1.804, 1, 1) as never;
  const rig = buildRig(scene, rest, { name: "cmp", allowMissing: true });
  const sh = rig.restPosition("LeftUpperArm"), el = rig.restPosition("LeftLowerArm");
  const ha = rig.restPosition("LeftHand");
  if (sh && el && ha) {
    console.log(`焼き込み ${v.padEnd(7)} 上腕 ${down(sh, el).toFixed(1)}° / 前腕 ${down(el, ha).toFixed(1)}°`
      + `  肩 x${sh.x.toFixed(3)} y${sh.y.toFixed(3)}`);
  }
  const hd=rig.restPosition("Head"), hp=rig.restPosition("Hips"), ft=rig.restPosition("LeftFoot");
  if(hd&&hp&&ft) console.log(`            頭 y${hd.y.toFixed(3)} / 腰 y${hp.y.toFixed(3)} / 足 y${ft.y.toFixed(3)}`);
  scene.dispose();
}
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");
const sh = m.rig.restPosition("LeftUpperArm")!, el = m.rig.restPosition("LeftLowerArm")!;
const ha = m.rig.restPosition("LeftHand")!;
const hd2=m.rig.restPosition("Head")!, hp2=m.rig.restPosition("Hips")!, ft2=m.rig.restPosition("LeftFoot")!;
console.log(`生モデル(rest)   頭 y${hd2.y.toFixed(3)} / 腰 y${hp2.y.toFixed(3)} / 足 y${ft2.y.toFixed(3)} / モデル身長 ${m.modelHeightCm.toFixed(1)}cm`);
for (const cm of [170, 198]) { m.setBody(cm, 80); m.root.computeWorldMatrix(true); console.log(`  setBody(${cm}) → root の倍率 ${m.root.scaling.x.toFixed(3)}`); }
m.setBody(180.4, 75);
console.log(`生モデル         上腕 ${down(sh, el).toFixed(1)}° / 前腕 ${down(el, ha).toFixed(1)}°`
  + `  肩 x${sh.x.toFixed(3)} y${sh.y.toFixed(3)}`);
