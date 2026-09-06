// 手のひらをボールに合わせる。
//
// ⚠️ IK はボールの中心へ手首を運ぶだけで、**手のひらの向き**も**ボールの表面に
//    当てること**もしていなかった。そのため手がボールよりかなり手前で止まり、
//    直径 50cm のボールを抱えたような形になっていた（実測で手のひらの当たる点が
//    ボール中心から 250〜300mm。半径は 120mm）。
//
// 解き方（式で一発で出す）:
//   ① 手のひらを向ける先 n ＝ 肩からボールへの向き
//   ② 手の回転 R ＝ 手のひらの法線 PALM_N を n へ向ける最小回転
//   ③ 当たってほしい点 contact ＝ ボール中心 − 半径 × n
//   ④ 手首の狙い wrist ＝ contact − R × PALM_PT
// ⚠️ 「実効長に手のひらぶん 135mm を足す」ではダメ。手のひらの法線と当たる点は
//    59° ずれていて、法線をボールへ向けると当たる点はその向きへ動く。長さに
//    足し込む方式では実測で 80mm 残った。
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import type { Player } from "../../objects/player/player";
import type { VoxelBody } from "../../objects/player/player-voxel";

/** ボールの半径（m）。メッシュは直径 0.24m。 */
export const BALL_R = 0.12;

/**
 * 静止姿勢での手のひらの法線。
 * ⚠️ メッシュの主成分（板の法線）から推定していたが、向きが 20° ずれていた
 *    （z 成分が -0.338、正しくは 0.003）。**指のボーンから**出し直す:
 *      面の法線 ＝ (人差し指→小指) × (手首→中指の付け根)、符号は親指側が表。
 * ⚠️ リグの静止姿勢は回転が単位なので、この値がそのままボーンのローカル軸。
 */
export const PALM_N: Record<string, Vector3> = {
  LeftHand: new Vector3(0.461, -0.887, 0.003),
  RightHand: new Vector3(-0.460, -0.888, 0.015),
};
/**
 * 手首から「手のひらの当たる点（中指の付け根）」まで（モデル 180.4cm）。
 * ⚠️ 中指の付け根のボーン LeftHandMiddle1 の位置そのもの（手首から 128mm）に、
 *    手の厚みの半分 22mm を手のひら側へ足したもの。以前はメッシュから推定して
 *    (-0.083,-0.105,-0.018) にしていたが、手の軸から外れていて持つ位置がずれた。
 */
export const PALM_PT: Record<string, Vector3> = {
  LeftHand: new Vector3(-0.104, -0.079, -0.008),
  RightHand: new Vector3(0.102, -0.078, -0.008),
};
/** モデル自身の身長（PALM_PT の基準）。 */
const MODEL_H = 1.804;
/** 残ったズレを詰める速さと上限（骨の繋がりの誤差ぶん）。 */
// ⚠️ 詰めすぎると片手が行き過ぎてボールへめり込む（実測で 61mm＝半径の半分）。控えめに。
const FIX_GAIN = 0.20, FIX_MAX = 0.20;

const _n = new Vector3();
const _off = new Vector3();
const _R = new Quaternion();
const _m = new Matrix();
const _rot = new Quaternion();
const _inv = new Quaternion();
const _fix = new Quaternion();
const _contact = new Vector3();
const _want = new Vector3();
const _d2 = new Vector3();

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

/**
 * 仮想の腕（左/右）に対応するボクセルのボーン名。
 * ⚠️ numberSide が +1 のとき骨組みごと 180° 回っていて、仮想の右手はボクセルの左手。
 *    手のひらの形は左右で鏡なので、ここを間違えると当たる点が 170mm 逆へ出る。
 */
function boneFor(p: Player, right: boolean): "LeftHand" | "RightHand" {
  return right === (p.numberSide > 0) ? "LeftHand" : "RightHand";
}

/** 手のひらを向ける先＝肩からボールへの向き（狙いの式と向きの適用で同じものを使う）。 */
function palmDir(p: Player, ball: Vector3, right: boolean, out: Vector3): Vector3 {
  const sy = p.pos.y + (p.vox ? p.vox.shoulder.y : p.height * 0.82);
  const half = p.vox ? Math.abs(p.vox.shoulder.x) : 0.2;
  const th = p.root.rotation.y;
  // 肩は体の左右にあるので、体の枠で ±half ずらしてから世界へ
  const sx = p.pos.x + (right ? 1 : -1) * half * Math.cos(th);
  const sz = p.pos.z - (right ? 1 : -1) * half * Math.sin(th);
  out.set(ball.x - sx, ball.y - sy, ball.z - sz);
  if (out.lengthSquared() < 1e-6) out.set(0, 1, 0);
  return out.normalize();
}

/** ボールを手のひらで受けるときの、IK の狙い（手首の位置）。 */
export function gripTarget(p: Player, ball: Vector3, right: boolean, out = new Vector3()): Vector3 {
  palmDir(p, ball, right, _n);
  const bone = boneFor(p, right);
  between(PALM_N[bone], _n, _R);
  PALM_PT[bone].scaleToRef(p.height / MODEL_H, _off);
  _off.rotateByQuaternionToRef(_R, _off);
  out.set(ball.x - _n.x * BALL_R - _off.x,
    ball.y - _n.y * BALL_R - _off.y,
    ball.z - _n.z * BALL_R - _off.z);
  const fix = right ? p.palmFixR : p.palmFixL;
  if (fix) out.addInPlace(fix);
  return out;
}

/** 手のボーン1本の手のひらを向け、当たる点のズレを err へ足す。 */
function aimOne(vb: VoxelBody, p: Player, right: boolean, ball: Vector3): void {
  const bone = boneFor(p, right);
  const hn = vb.rig.node(bone as StandardBoneName);
  const an = vb.rig.node((bone === "LeftHand" ? "LeftLowerArm" : "RightLowerArm") as StandardBoneName);
  if (!hn || !an) return;
  vb.root.computeWorldMatrix(true);
  an.computeWorldMatrix(true);
  const rootInv = Matrix.Invert(vb.root.getWorldMatrix());
  const o = Vector3.TransformCoordinates(Vector3.Zero(), rootInv);
  // 向ける先を素体ローカルへ
  palmDir(p, ball, right, _n);
  Vector3.TransformCoordinatesToRef(_n, rootInv, _d2);
  _d2.subtractInPlace(o).normalize();
  // 前腕までの回転を打ち消してから、手のひらの法線を向ける
  an.getWorldMatrix().multiplyToRef(rootInv, _m);
  _m.decompose(undefined, _rot, undefined);
  _rot.conjugateToRef(_inv);
  between(PALM_N[bone], _d2, _fix);
  if (!hn.rotationQuaternion) hn.rotationQuaternion = Quaternion.Identity();
  _inv.multiplyToRef(_fix, hn.rotationQuaternion);
  hn.markAsDirty("rotationQuaternion");
  // 回したあとの当たる点を測って、狙いとの差を返す
  hn.computeWorldMatrix(true);
  Vector3.TransformCoordinatesToRef(
    PALM_PT[bone].scale(p.height / MODEL_H), hn.getWorldMatrix(), _contact);
  _want.set(ball.x - _n.x * BALL_R, ball.y - _n.y * BALL_R, ball.z - _n.z * BALL_R);
  // 骨の繋がりの誤差ぶんは、次のフレームの狙いへ詰めて足す（左右別）
  let fix = right ? p.palmFixR : p.palmFixL;
  if (!fix) { fix = new Vector3(0, 0, 0); if (right) p.palmFixR = fix; else p.palmFixL = fix; }
  fix.addInPlace(_want.subtract(_contact).scale(FIX_GAIN));
  const len = fix.length();
  if (len > FIX_MAX) fix.scaleInPlace(FIX_MAX / len);
}

/** 手のひらをボールへ向ける（姿勢を作り終えたあとに1回）。 */
export function aimPalms(vb: VoxelBody, p: Player): void {
  const ball = p.palmBall;
  if (!ball) return;
  if (p.palmBoth) { aimOne(vb, p, true, ball); aimOne(vb, p, false, ball); }
  else aimOne(vb, p, p.palmRight, ball);
}

/** 別のボールを取りにいくときは詰めた値を捨てる。 */
export function resetPalmFix(p: Player): void { p.palmFixR = null; p.palmFixL = null; }
