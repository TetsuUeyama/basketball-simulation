// ボールキャッチの形。ボールが**どこにあるか**（高さ・横ズレ）で変える。
//
//   高い＋正面   … 頭の上で両手キャッチ（リバウンド）
//   胸の高さ＋正面 … 胸の前で両手キャッチ
//   低い＋正面   … 下ですくう両手キャッチ
//   横にズレている … その側の**片手**でキャッチ（反対の腕は体を守る）
//
// ⚠️ 片手／両手は `reachBall(world, both)` に任せていたが、あれは片手のとき必ず
//    右腕を使う。左へズレたボールを右手で体を横切って取りにいくので、横ズレに
//    合わせて腕を選ぶ必要がある。
import { Quaternion, Vector3 } from "@babylonjs/core";
import { MOVE_RATE } from "../basic/joints";
import { gripTarget } from "./palm";
import type { Player } from "../../objects/player/player";

/** 横ズレがこれを超えたら片手（腕の長さに対する比）。 */
const TWO_SIDE = 0.42;
/** 高さの呼び名の境目（腰=0、頭の上=1）。 */
const HIGH_AT = 0.68, CHEST_AT = 0.22;
/** 両手のひらの間隔。高いほど広げて構える（m）。 */
// ⚠️ 手のひらの当たる点（手首から 135mm）を狙いに織り込むようにしたので、ここで
//    左右へ広げる必要はほぼ無い。以前の 12〜17cm は、その当たる点を無視して
//    手首をボール中心へ運んでいたぶんの埋め合わせだった。
const SEP_LO = 0.02, SEP_HI = 0.05;
const _grip = new Vector3();

export type CatchShape = {
  /** 両手で取るか。 */
  two: boolean;
  /** 高さ 0..1。0 = 腰、0.5 くらいが肩、1 = 頭の上いっぱい。 */
  hi: number;
  /** 横ズレ -1..1（体の右が +）。腕の長さに対する比。 */
  side: number;
  /** 片手のとき使う腕。 */
  right: boolean;
};

/** ボールの位置から、キャッチの形を決める。 */
export function catchShape(p: Player, b: Vector3): CatchShape {
  const armLen = Math.max(0.3, p.upperArmLen + p.foreArmLen);
  // ⚠️ 高さの基準は肩ではなく**腰**から。肩を 0 にすると胸の高さのボールが全部
  //    「低い」に落ちて、呼び名も手の広げ方も合わなかった。
  const hipY = p.pos.y + (p.vox ? p.vox.hipY : p.height * 0.52);
  const topY = p.pos.y + p.height * 1.28;
  const hi = Math.min(1, Math.max(0, (b.y - hipY) / Math.max(0.2, topY - hipY)));
  // 横ズレ: 体の枠へ落として、右向き成分を腕の長さで割る
  const th = p.root.rotation.y + p.torsoTwist;
  const c = Math.cos(th), s = Math.sin(th);
  const dx = b.x - p.pos.x, dz = b.z - p.pos.z;
  const lat = c * dx - s * dz;                 // root ローカルの +X（体の右）
  const side = Math.min(1, Math.max(-1, lat / armLen));
  // 届かないほど高い／遠いときは両手構えが成り立たない
  const reachable = b.y < p.reachTopY() + 0.15 && Math.hypot(dx, dz) < armLen * 1.15;
  const two = reachable && Math.abs(side) < TWO_SIDE;
  return { two, hi, side, right: side >= 0 };
}

/**
 * 決めた形で手を出す。
 * ⚠️ 頭の上の両手キャッチ（リバウンド）はここが本体。両手を少し離してボールを
 *    挟む形にする。間隔は高いほど広げる。
 */
export function catchBallHands(p: Player, b: Vector3, shape: CatchShape): void {
  p.catchHi = shape.hi;
  p.catchSide = shape.side;
  p.catchTwo = shape.two;
  // ⚠️ 狙いはボールの中心ではなく**手前**。手のひらの当たる点がボールの表面に
  //    来るように引く。向きは sync のあとで aimPalms が合わせる。
  const t = gripTarget(p, b, _grip);
  p.palmBall = b.clone();
  p.palmBoth = shape.two;
  p.palmRight = shape.right;
  if (shape.two) {
    // 高いほど手を広げて挟む
    p.holdBallHands(t, SEP_LO + (SEP_HI - SEP_LO) * shape.hi);
    return;
  }
  // 片手: ズレている側の腕で取る
  const pivot = shape.right ? p.armPivotR : p.armPivotL;
  const elbow = shape.right ? p.elbowR : p.elbowL;
  const off = shape.right ? p.armPivotL : p.armPivotR;
  const offElbow = shape.right ? p.elbowL : p.elbowR;
  p.armRateCap = MOVE_RATE.reach;
  if (!p.reachIK(pivot, elbow, t)) {
    p.aimArm(pivot, b);
    p.bendElbow(elbow, 0.05);      // 届かないので伸ばし切る
  }
  // 反対の腕は体の前に添える（真下に垂らさない）
  p.easeArm(off, Quaternion.RotationAxis(new Vector3(1, 0, 0), 0.35 * p.numberSide));
  p.bendElbow(offElbow, 0.9);
  p.armRateCap = 0;
}

/** 位置から形を決めて手を出す（ひとまとめ）。 */
export function catchBall(p: Player, b: Vector3): CatchShape {
  const shape = catchShape(p, b);
  catchBallHands(p, b, shape);
  return shape;
}

/**
 * 形の呼び名（表示用）。
 * ⚠️ shape.right は**仮想の骨組み**での右腕。numberSide が +1 のときは骨組みごと
 *    180° 回っているので、見た目の左右は逆になる。表示は見た目に合わせる。
 */
export function catchLabel(p: Player, shape: CatchShape): string {
  const h = shape.hi > HIGH_AT ? "頭の上" : shape.hi > CHEST_AT ? "胸の高さ" : "低い";
  const visualRight = shape.right !== (p.numberSide > 0);
  return `${h} / ${shape.two ? "両手" : (visualRight ? "右" : "左") + "の片手"}`;
}
