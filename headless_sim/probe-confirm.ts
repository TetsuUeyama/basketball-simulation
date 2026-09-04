// 確認ページ(/confirm.html)と**同じ手順**で Player を作り、モーションで実際に動くかを測る。
// ⚠️ 順番の検証が目的: p.sync() は syncVoxelPose() でリグを書き直すので、
//    applyMotion を sync より先に呼ぶと上書きされて動かない。
import "./stubs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { Player } from "../src/objects/player/player";
import { setVariantOverride, type BodyVariant } from "../vendor/objcts/player/voxel/voxelBody";
import { motionClip, motionDuration, applyMotion } from "../vendor/objcts/player/motion/clip";
import { ROSTER } from "../src/roster";
import "../src/objects/player/player-query";
import "../src/objects/player/player-state";
import "../src/objects/player/player-visual";
import "../src/objects/player/player-roster";
import "../src/move/basic/run";
import "../src/move/basic/jump";
import "../src/move/basic/turn";
import "../src/animation/basic/arms";
import "../src/animation/basic/torso";
import "../src/animation/action/locomotion";
import "../src/animation/action/hold";
import "../src/animation/action/sit";

const engine = new NullEngine();
const scene = new Scene(engine);

const variant = (process.env.VARIANT ?? "p1") as BodyVariant;
setVariantOverride(variant);
const def = { ...ROSTER[0][0], height: 1.95 };
const p = new Player(scene, 0, 0, def);
p.applyUniform();
setVariantOverride(null);

const vb = p.vox;
if (!vb) { console.log("★ vox が組まれていない（ここで止まる）"); process.exit(1); }
console.log(`体型 ${variant}: メッシュ ${vb.meshes.length} / リグのノードあり=${!!vb.rig.node("LeftHand")}`);

const BONES = ["LeftHand", "RightHand", "LeftFoot", "Head"] as const;
const at = (b: string): Vector3 => {
  const n = vb.rig.node(b as never);
  if (!n) return Vector3.Zero();
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition().clone();
};

/** 確認ページの applyPose と同じ（sync が先、クリップが後）。 */
function applyPose(time: number, name: string): void {
  const clip = motionClip(name);
  p.sync();
  if (!clip) return;
  applyMotion(vb!.rig, clip, time % motionDuration(clip), { rootMotion: "vertical", leanDeg: 0 });
  vb!.skel.prepare();
}
/** 直す前の順番（クリップが先、sync が後）＝上書きされるはずの形。 */
function applyPoseOld(time: number, name: string): void {
  const clip = motionClip(name);
  if (clip) applyMotion(vb!.rig, clip, time % motionDuration(clip), { rootMotion: "vertical", leanDeg: 0 });
  p.sync();
}

for (const [label, fn] of [["直した順（sync→クリップ）", applyPose], ["前の順（クリップ→sync）", applyPoseOld]] as const) {
  console.log(`\n--- ${label} ---`);
  for (const name of (process.env.CLIPS ?? "dribbleRun,jump,layup").split(",")) {
    const c = motionClip(name);
    if (!c) { console.log(`  ${name}: クリップが無い`); continue; }
    const dur = motionDuration(c);
    const base: Record<string, Vector3> = {};
    fn(0, name);
    for (const b of BONES) base[b] = at(b);
    let maxMove = 0;
    const per: string[] = [];
    for (const b of BONES) {
      let mx = 0;
      for (const k of [0.25, 0.5, 0.75]) { fn(dur * k, name); mx = Math.max(mx, Vector3.Distance(base[b], at(b))); }
      maxMove = Math.max(maxMove, mx);
      per.push(`${b} ${(mx * 100).toFixed(1)}cm`);
    }
    console.log(`  ${name.padEnd(11)} ${per.join(" / ")}  → ${maxMove > 0.02 ? "動く" : "★動かない"}`);
  }
}
