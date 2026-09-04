// 生のボクセル（voxel-pipeline の出力）がモデル自身のスケルトンで動くかを実測する。
// 確認ページ(/confirm.html)と同じ経路: skeleton.json → RestPose → buildRig → applyMotion。
import "./stubs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { buildRig } from "../vendor/objcts/player/rig";
import { restPoseFrom } from "../vendor/objcts/player/restPose";
import { MIXAMO_NO_PREFIX } from "../vendor/objcts/player/presets";
import { motionClip, motionDuration, applyMotion } from "../vendor/objcts/player/motion/clip";
import { toBabylon } from "../src/voxraw";
import { readFileSync } from "node:fs";

const DIR = process.env.VOXDIR ?? "C:/Users/user/developsecond/game-assets/vox-model/player_one";
const skel = JSON.parse(readFileSync(`${DIR}/skeleton.json`, "utf8")) as
  { bones: { name: string; head_rest: number[] }[] };
const root = JSON.parse(readFileSync(`${DIR}/grid.json`, "utf8")) as { bb_min: number[]; bb_max: number[] };
const height = root.bb_max[2] - root.bb_min[2];

const engine = new NullEngine();
const scene = new Scene(engine);

const src: Record<string, [number, number, number]> = {};
for (const b of skel.bones) src[b.name] = toBabylon(b.head_rest[0], b.head_rest[1], b.head_rest[2]);
const rest = restPoseFrom(src, MIXAMO_NO_PREFIX, "left", height);
console.log(`skeleton.json の骨 ${skel.bones.length} → 標準ボーンへ ${Object.keys(rest.positions).length} 本 読み替え`);
console.log(`  ${Object.keys(rest.positions).join(" ")}`);

const rig = buildRig(scene, rest, { name: "raw", allowMissing: true });
const BONES = ["LeftHand", "RightHand", "LeftFoot", "RightFoot", "Head"] as const;
const missing = BONES.filter((b) => !rig.node(b));
if (missing.length) console.log(`★ リグに無い: ${missing.join(" ")}`);

const at = (b: string): Vector3 => {
  const n = rig.node(b as never);
  if (!n) return Vector3.Zero();
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition().clone();
};

console.log(`\n身長 ${height.toFixed(3)}m / 腕の向き: ` +
  JSON.stringify(Vector3.Distance(at("LeftHand"), at("RightHand")).toFixed(3)) + "m（左右の手の間隔）");

for (const name of (process.env.CLIPS ?? "idle,dribbleRun,jump,layup,passChest").split(",")) {
  const c = motionClip(name);
  if (!c) { console.log(`  ${name}: クリップが無い`); continue; }
  const dur = motionDuration(c);
  applyMotion(rig, c, 0, { rootMotion: "vertical", leanDeg: 0 });
  const base: Record<string, Vector3> = {};
  for (const b of BONES) base[b] = at(b);
  const per: string[] = [];
  let mx = 0;
  for (const b of BONES) {
    let d = 0;
    for (const k of [0.25, 0.5, 0.75]) {
      applyMotion(rig, c, dur * k, { rootMotion: "vertical", leanDeg: 0 });
      d = Math.max(d, Vector3.Distance(base[b], at(b)));
    }
    mx = Math.max(mx, d);
    per.push(`${b} ${(d * 100).toFixed(1)}cm`);
  }
  console.log(`  ${name.padEnd(11)} ${per.join(" / ")} → ${mx > 0.02 ? "動く" : "★動かない"}`);
}
