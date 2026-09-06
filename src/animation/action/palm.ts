// 手のひらをボールに合わせる。
//
// ⚠️ IK はボールの中心へ手首の少し先を運ぶだけで、**手のひらの向き**も
//    **ボールの表面に当てること**もしていなかった。そのため手のひらがボールを
//    向いておらず、ボールが手に埋まったり手首の先で浮いたりしていた。
// ここでは2つやる:
//   ① IK の狙いをボールの手前へ引く（手のひらがボールの表面に当たる位置）
//   ② 手のボーンを回して、手のひらの法線をボールへ向ける
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import type { Player } from "../../objects/player/player";
import type { VoxelBody } from "../../objects/player/player-voxel";

/** ボールの半径（m）。 */
export const BALL_R = 0.12;

/**
 * 静止姿勢での手のひらの法線（メッシュから実測）。指先寄りの頂点で
 * ばらつきが最小の向き＝板の法線。
 * ⚠️ リグの静止姿勢は回転が単位なので、この値がそのままボーンのローカル軸。
 */
export const PALM_N: Record<string, Vector3> = {
  LeftHand: new Vector3(0.263, -0.904, -0.338),
  RightHand: new Vector3(-0.279, -0.885, -0.373),
};
/**
 * 手首から「手のひらの当たる点（中指の付け根あたり）」までの向きと距離（モデル 180.4cm）。
 * 手の長軸の 55% の位置で、手のひら面まで出た点。実測 135mm。
 */
export const PALM_PT: Record<string, Vector3> = {
  LeftHand: new Vector3(-0.083, -0.105, -0.018),
  RightHand: new Vector3(0.085, -0.105, -0.020),
};
/** モデル自身の身長（PALM_PT の基準）。 */
const MODEL_H = 1.804;
/**
 * IK の狙いをボールの中心からどれだけ手前へ引くか（m）。
 * ⚠️ 実測で決めた値。IK が運ぶのは手首の少し先で、そこから手のひらの当たる点までは
 *    さらに先にある。ボール半径ぶんと合わせてここで引く。
 */
const GRIP_PULL = BALL_R;

/**
 * ボールを手のひらで受けるときの、IK の狙い（手首側）。
 * ⚠️ 仮想の骨組みとボクセルのボーンは長さも位置も一致しない（実測で手首が 95mm ずれる）。
 *    その上、手首から手のひらの当たる点まで 135mm ある。式で埋めようとしても合わない
 *    ので、**前のフレームの実測ズレ**を狙いへ足して詰める（数フレームで収束）。
 */
export function gripTarget(p: Player, ball: Vector3, out = new Vector3()): Vector3 {
  const sy = p.pos.y + (p.vox ? p.vox.shoulder.y : p.height * 0.82);
  const dx = ball.x - p.pos.x, dy = ball.y - sy, dz = ball.z - p.pos.z;
  const l = Math.hypot(dx, dy, dz);
  // ⚠️ ボール半径ぶんだけ手前が狙い。実効長が手のひらの当たる点までになったので、
  //    ここで余分に引く必要はない。
  const pull = GRIP_PULL * (p.height / MODEL_H);
  if (l < pull + 0.05) out.copyFrom(ball);          // 近すぎるときは引かない
  else out.set(ball.x - (dx / l) * pull, ball.y - (dy / l) * pull, ball.z - (dz / l) * pull);
  if (p.palmFix) out.addInPlace(p.palmFix);
  return out;
}

/** 狙いのずらし量を詰める速さと上限。 */
const FIX_GAIN = 0.35;
const FIX_MAX = 0.25;
const _contact = new Vector3();
const _want = new Vector3();

const _m = new Matrix();
const _rot = new Quaternion();
const _inv = new Quaternion();
const _dir = new Vector3();
const _fix = new Quaternion();

/** a を b へ向ける最小の回転。 */
function between(a: Vector3, b: Vector3, out: Quaternion): Quaternion {
  const dot = Vector3.Dot(a, b);
  if (dot > 0.999999) return out.copyFromFloats(0, 0, 0, 1);
  if (dot < -0.999999) {
    const ax = Math.abs(a.x) < 0.9 ? Vector3.Cross(a, Vector3.Right()) : Vector3.Cross(a, Vector3.Up());
    return Quaternion.RotationAxisToRef(ax.normalize(), Math.PI, out);
  }
  const ax = Vector3.Cross(a, b);
  out.set(ax.x, ax.y, ax.z, 1 + dot);
  out.normalize();
  return out;
}

/** 手のボーン1本の手のひらを、ワールドの点へ向け、当たる点のズレを返す。 */
function aimOne(vb: VoxelBody, p: Player, bone: "LeftHand" | "RightHand",
                target: Vector3, err: Vector3): void {
  const hn = vb.rig.node(bone as StandardBoneName);
  const an = vb.rig.node((bone === "LeftHand" ? "LeftLowerArm" : "RightLowerArm") as StandardBoneName);
  if (!hn || !an) return;
  an.computeWorldMatrix(true);
  hn.computeWorldMatrix(true);
  vb.root.computeWorldMatrix(true);
  const rootInv = Matrix.Invert(vb.root.getWorldMatrix());
  // 手からボールへの向きを素体ローカルへ
  const hw = hn.getAbsolutePosition();
  _dir.set(target.x - hw.x, target.y - hw.y, target.z - hw.z);
  if (_dir.lengthSquared() < 1e-8) return;
  _dir.normalize();
  const o = Vector3.TransformCoordinates(Vector3.Zero(), rootInv);
  const d2 = Vector3.TransformCoordinates(_dir, rootInv).subtract(o).normalize();
  // 前腕までの回転を打ち消してから、手のひらの法線を向ける
  an.getWorldMatrix().multiplyToRef(rootInv, _m);
  _m.decompose(undefined, _rot, undefined);
  _rot.conjugateToRef(_inv);
  between(PALM_N[bone], d2, _fix);
  if (!hn.rotationQuaternion) hn.rotationQuaternion = Quaternion.Identity();
  _inv.multiplyToRef(_fix, hn.rotationQuaternion);
  hn.markAsDirty("rotationQuaternion");
  // 回したあとの「当たる点」を測って、ボールの表面との差を返す
  hn.computeWorldMatrix(true);
  const k = p.height / MODEL_H;
  Vector3.TransformCoordinatesToRef(PALM_PT[bone].scale(k), hn.getWorldMatrix(), _contact);
  // 狙う位置＝ボール中心から手のひら側へ半径ぶん戻った点
  _want.set(target.x - _dir.x * BALL_R, target.y - _dir.y * BALL_R, target.z - _dir.z * BALL_R);
  err.addInPlace(_want.subtract(_contact));
}

/**
 * 手のひらをボールへ向ける（姿勢を作り終えたあとに1回）。
 * ⚠️ numberSide が +1 のとき骨組みごと 180° 回っていて、仮想の右手はボクセルの左手。
 */
export function aimPalms(vb: VoxelBody, p: Player): void {
  const ball = p.palmBall;
  if (!ball) return;
  const back = p.numberSide > 0;
  const err = new Vector3(0, 0, 0);
  let n = 0;
  if (p.palmBoth) {
    aimOne(vb, p, "LeftHand", ball, err);
    aimOne(vb, p, "RightHand", ball, err);
    n = 2;
  } else {
    aimOne(vb, p, p.palmRight === back ? "LeftHand" : "RightHand", ball, err);
    n = 1;
  }
  // 次のフレームの狙いへ、実測したズレを詰めて足す
  if (!p.palmFix) p.palmFix = new Vector3(0, 0, 0);
  p.palmFix.addInPlace(err.scale(FIX_GAIN / n));
  const len = p.palmFix.length();
  if (len > FIX_MAX) p.palmFix.scaleInPlace(FIX_MAX / len);
}

/** 別のボールを取りにいくときは詰めた値を捨てる。 */
export function resetPalmFix(p: Player): void { p.palmFix = null; }
