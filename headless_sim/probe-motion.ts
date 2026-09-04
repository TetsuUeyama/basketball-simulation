// 新モデル(p1)がゲームのモーションクリップで実際に動くかを確かめる。
// モーションはモデル固有のスケルトン(52骨)ではなく、焼き込んだ joints から組む
// **標準16ボーンのリグ**に対して適用される。だからモデルを替えても動くはず、を実測する。
import "./stubs";
import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { bodyRestPose, DEFAULT_WIDTH_EXPONENT, DEFAULT_HEAD_EXPONENT,
         type BodyVariant } from "../vendor/objcts/player/voxel/voxelBody";
import { buildRig } from "../vendor/objcts/player/rig";
import { motionClip, motionDuration, applyMotion, MOTION_NAMES } from "../vendor/objcts/player/motion/clip";
import type { RestPose } from "../vendor/objcts/player/restPose";

const engine = new NullEngine();
const scene = new Scene(engine);

const CLIPS = (process.env.CLIPS ?? "idle,dribbleRun,jump,layup,passChest").split(",");
const HEIGHT = 1.95;

function world(n: TransformNode | null): Vector3 {
  if (!n) return Vector3.Zero();
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition().clone();
}

for (const variant of ["p1", "normal"] as BodyVariant[]) {
  const rest = bodyRestPose(variant, HEIGHT, DEFAULT_WIDTH_EXPONENT, DEFAULT_HEAD_EXPONENT) as unknown as RestPose;
  const rig = buildRig(scene, rest, { name: `t_${variant}`, allowMissing: true });
  const bones = ["LeftHand", "RightHand", "LeftFoot", "RightFoot", "Head"] as const;
  console.log(`\n=== ${variant} ===`);
  const missing = bones.filter((b) => !rig.node(b));
  if (missing.length) console.log(`  ⚠️ ノードが無い: ${missing.join(" ")}`);

  for (const name of CLIPS) {
    const clip = motionClip(name);
    if (!clip) { console.log(`  ${name}: クリップが無い`); continue; }
    const dur = motionDuration(clip);
    const samples = [0, dur * 0.25, dur * 0.5, dur * 0.75];
    const track: Record<string, Vector3[]> = {};
    for (const t of samples) {
      applyMotion(rig, clip, t, { rootMotion: "vertical", leanDeg: 0 });
      for (const b of bones) (track[b] ??= []).push(world(rig.node(b)));
    }
    // 各ボーンが動いた最大距離（0 なら「動いていない」）
    const moved = bones.map((b) => {
      const ps = track[b] ?? [];
      let mx = 0;
      for (let i = 1; i < ps.length; i++) mx = Math.max(mx, Vector3.Distance(ps[0], ps[i]));
      return `${b} ${(mx * 100).toFixed(1)}cm`;
    });
    console.log(`  ${name.padEnd(12)} ${dur.toFixed(2)}s  ${moved.join(" / ")}`);
  }
}

console.log(`\n使えるクリップ ${MOTION_NAMES.length} 本: ${MOTION_NAMES.slice(0, 12).join(" ")} …`);
