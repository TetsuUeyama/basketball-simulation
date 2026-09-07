// ドリブルアクションのアニメ: ボール側の手で運ぶ。basic/arms のムーバ経由で動く。
import { Vector3, Quaternion, Matrix } from "@babylonjs/core";
import { Player } from "../../objects/player/player";
import type { VoxelBody } from "../../objects/player/player-voxel";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import { PALM_N } from "./palm";
import type { TransformNode } from "@babylonjs/core";
import { armStyleFor } from "../basic/arm-style";

declare module "../../objects/player/player" {
  interface Player {
    reachDribble(world: Vector3, useRight: boolean, rate?: number, guardAt?: Vector3 | null): void;
    /** このフレームでドリブルの手を作った（sync が手のひらを水平に均すのに使う）。 */
    dribblePosed: boolean;
    /** そのフレームのドリブルの狙い（ワールド）。 */
    dribbleAt: Vector3;
  }
}
Player.prototype.dribblePosed = false;
Player.prototype.dribbleAt = new Vector3();

/** 相手を寄せ付けない腕の伸ばし具合。0.5 でほぼ伸ばし切り。 */
const GUARD_ELBOW = 0.5;
/** ドリブルの手を組むときの肘の張り出し。既定(0.70)より小さく＝肘を体寄りに残す。 */
const DRIB_ELBOW_OUT = 0.45;
/** 手首をここまでしか曲げない(rad ≈ 55°)。人の手のひら側への可動域はおおよそ 60〜70°。
 *  残りは曲げずに置く（手のひらが少し傾くが、手首が折れているよりは自然）。 */
/** 手首をここまでしか曲げない(rad ≈ 55°)。人の手のひら側への可動域はおおよそ 60〜70°。 */
const WRIST_CAP = 1.22;
/** 肩をこの範囲(rad ≈ 100°)で回して、手首が一番楽になる角度を探す。 */
const SHOULDER_RANGE = 1.75;
/** 探索の刻み（±この数だけ両側に振る）。 */
const SHOULDER_STEPS = 12;
/** 肩を大きく回すことへの罰則（rad あたり）。小さすぎると肩が回りすぎる。 */
const SHOULDER_PENALTY = 0.10;
/** 手のひらの狙いを真下からボール側へどれだけ倒すか（tan 相当）。0 = 真下。 */
const PALM_LEAN = 0.55;
/** ドリブルの手首を置く距離。腕の長さのこの割合（1.0 = 伸ばし切り）。 */
const DRIB_EXTEND = 0.90;
const _wrist = new Vector3();
/** 空いている手が相手へ向く距離（m）。これより遠ければ普通に腕を振る。 */
export const GUARD_RANGE = 1.9;

/** ボールがある側と同じ側の手でドリブル/保持する — 左腰へ運んだボールは右腕を
 *  体を横切って（越えて）伸ばすのではなく左手で持つ、そしてその逆も。 */
Player.prototype.reachDribble = function(
  world: Vector3, useRight: boolean, rate = 0, guardAt: Vector3 | null = null,
): void {
    this.dribbleArm = useRight ? "R" : "L";
    this.dribbleAt.copyFrom(world);   // 手のひらを向ける先（levelDribbleHand が使う）
    this.dribblePosed = true;
    const near = useRight ? this.armPivotR : this.armPivotL;
    const nearElbow = useRight ? this.elbowR : this.elbowL;
    const far = useRight ? this.armPivotL : this.armPivotR;
    const farElbow = useRight ? this.elbowL : this.elbowR;
    this.armRateCap = rate;   // > 0 → 手はドリブル精度の速度で置き直す
    // ⚠️ 以前は「肩からボールへ真っ直ぐ腕を伸ばす」だけだった（肘は伸ばし切り）。
    //    腕が一直線なので前腕は腕全体と同じ傾きになり、実測で鉛直から 64°（95%で
    //    128°＝ほぼ水平〜上向き）。そこから手のひらを床と平行にするので、補正が
    //    全部手首に載って中央 55°・最大 174° 曲がっていた。
    //    IK で手首をボールの上へ置き、**肘を手首の上へ逃がして前腕を立てる**。
    //    ⚠️ 呼び元は高さ 0.95m 固定で渡してくるが、肩から 0.4m 横にあるその点までは
    //    実測で 0.60m あり、腕の長さ 0.50m では**そもそも届かない**。毎フレーム
    //    届かない点を狙っていたので IK も解けず、腕は伸ばし切りの棒のままだった。
    //    届く範囲（伸ばし切らない 0.90 倍）へ引き寄せてから解く。
    const th = this.root.rotation.y + this.torsoTwist;
    const cc = Math.cos(th), ss = Math.sin(th);
    const ax = near.position.x, ay = near.position.y * this.root.scaling.y, az = near.position.z;
    const sx = this.root.position.x + (cc * ax + ss * az);
    const sy = this.root.position.y + ay;
    const sz = this.root.position.z + (-ss * ax + cc * az);
    const L = (this.upperArmLen + this.foreArmLen) * DRIB_EXTEND;
    const vx = world.x - sx, vy = world.y - sy, vz = world.z - sz;
    const vd = Math.hypot(vx, vy, vz) || 1;
    if (vd > L) _wrist.set(sx + (vx / vd) * L, sy + (vy / vd) * L, sz + (vz / vd) * L);
    else _wrist.copyFrom(world);
    this.elbowOut = DRIB_ELBOW_OUT;
    this.elbowPoleY = 1;             // 肘は上へ（下へ逃がすと前腕が寝る）
    const ik = this.reachIK(near, nearElbow, _wrist);
    this.elbowOut = 0.70; this.elbowPoleY = -1;   // 既定へ戻す（他のIK利用へ持ち越さない）
    if (!ik) {                       // 届かない: 従来どおり方向だけ合わせる
      this.aimArm(near, world);
      this.bendElbow(nearElbow, 0.30);
    }
    this.armRateCap = 0;
    // --- 空いている手 -------------------------------------------------------
    if (guardAt) {
      // 相手が近い: その選手へ腕を伸ばして間合いを作る（オフアーム）。
      // 胸の高さへ向ける。ボールと反対側なので体を挟んで守れる。
      this.aimArm(far, new Vector3(guardAt.x, this.pos.y + 1.15, guardAt.z));
      this.bendElbow(farElbow, GUARD_ELBOW);
      return;
    }
    // 相手が遠い: 歩き／走りと同じように振る。
    // ⚠️ runArms と同じ位相（左腕 ↔ 右脚）にしないと、空いている手だけ脚とずれる。
    const frac = this.runSpeed > 0 ? Math.min(1, this.curSpd / this.runSpeed) : 0;
    if (frac < 0.16) {
      this.easeArm(far, Quaternion.Identity());
      this.bendElbow(farElbow, 0.28);
      return;
    }
    // ⚠️ 癖(振り幅・肘の引き)は runArms と同じものを使う。ここだけ既定値だと、
    //    ドリブルを始めた瞬間に空いている手の振りが別人のものに変わる。
    const st = armStyleFor(this);
    const amp = (0.3 + frac * 0.55) * st.swing;
    const phase = far === this.armPivotL ? this.stridePhase + Math.PI : this.stridePhase;
    const s = Math.sin(phase);
    this.easeArm(far, Quaternion.RotationAxis(new Vector3(1, 0, 0), s * amp * this.numberSide));
    const pull = far === this.armPivotL ? st.pullL : st.pullR;
    this.bendElbow(farElbow, (0.6 + frac * 0.5) * st.carry - pull * Math.max(0, -s) * frac);
};

// ───────────────────────── 手のひらを水平に ─────────────────────────
// ⚠️ 手の向きは wristTrail（前腕に遅れて付いていく）だけで決まっていて、狙った向きに
//    することができなかった。ドリブルの手は手のひらが床と平行でないとボールを突いて
//    いるように見えない。
// ⚠️ 手のひらの法線は palm.ts のものを使う。ここには独自の値が置いてあったが、
//    (0.263,-0.904,-0.338) はメッシュの頂点分布から推定した**古い値**で、指の骨から
//    出し直した正しい値 (0.461,-0.887,0.003) とは 23° ずれている。ずれた法線を
//    水平に合わせていたので、実際の手のひらはその分だけ傾いたままだった。
const DOWN = new Vector3(0, -1, 0);
const _m = new Matrix();
const _rot = new Quaternion();
const _inv = new Quaternion();

const _need = new Quaternion();
const _IDENT = Quaternion.Identity();
const _rq = new Quaternion(), _fq = new Quaternion(), _iq = new Quaternion();
const _nq = new Quaternion(), _pq = new Quaternion(), _uq = new Quaternion();
const _mi = new Matrix();
const _mi2 = new Matrix();
const _hp2 = new Vector3(), _tp2 = new Vector3(), _to = new Vector3();
const _sp = new Vector3(), _hp = new Vector3(), _axis = new Vector3();

/** a を b へ向ける最小の回転。 */
function between(a: Vector3, b: Vector3): Quaternion {
  const dot = Vector3.Dot(a, b);
  if (dot > 0.999999) return Quaternion.Identity();
  if (dot < -0.999999) {
    const ax = Math.abs(a.x) < 0.9 ? Vector3.Cross(a, Vector3.Right()) : Vector3.Cross(a, Vector3.Up());
    return Quaternion.RotationAxis(ax.normalize(), Math.PI);
  }
  const ax = Vector3.Cross(a, b);
  const q = new Quaternion(ax.x, ax.y, ax.z, 1 + dot);
  q.normalize();
  return q;
}

/**
 * ドリブルしている側の手のひらを床と平行にする。
 * 手のワールド向き = 親の積 ⊗ 手のローカル なので、親の積を打ち消したうえで
 * 「静止の法線 → 真下」の補正を入れる。
 */
export function levelDribbleHand(vb: VoxelBody, p: Player): void {
  if (!p.dribbleArm) return;
  // ⚠️ numberSide が +1 のとき骨組みごと 180° 回っていて、仮想の右手はボクセルの左手。
  const useLeftBone = (p.dribbleArm === "R") === (p.numberSide > 0);
  const hand = useLeftBone ? "LeftHand" : "RightHand";
  const arm = useLeftBone ? "LeftLowerArm" : "RightLowerArm";
  const hn = vb.rig.node(hand as StandardBoneName);
  const an = vb.rig.node(arm as StandardBoneName);
  if (!hn || !an) return;
  an.computeWorldMatrix(true);
  vb.root.computeWorldMatrix(true);
  // 前腕の「素体ローカルでの向き」を取り出す
  vb.root.getWorldMatrix().invertToRef(_mi2);
  an.getWorldMatrix().multiplyToRef(_mi2, _m);
  _m.decompose(undefined, _rot, undefined);
  _rot.conjugateToRef(_inv);
  // 手のひらを向ける先。⚠️ 「真下」に固定すると、この素体の骨の並び（Tポーズ由来）
  //    では手首が 104° 曲がる形しか解が無く、肩をどう回しても 99° 未満にできない
  //    （実測: 肩を ±100° 振っても必要角は 99〜152°）。実際のドリブルで手のひらが
  //    向くのは「突いているボール」なので、そちらを狙う。真下よりずっと楽な形になる。
  hn.computeWorldMatrix(true);
  Vector3.TransformCoordinatesToRef(hn.getAbsolutePosition(), _mi2, _hp2);
  Vector3.TransformCoordinatesToRef(p.dribbleAt, _mi2, _tp2);
  //    ⚠️ ただし「ボールへの方向」そのままではいけない。手はボールまで届いていない
  //    （腕 0.50m に対し必要 0.60m）ので、手とボールの高さがほぼ同じになり、狙いが
  //    真横になってしまう（実測で手のひらが前を向いた）。真下を基本に、ボールの側へ
  //    少しだけ倒す。
  _tp2.subtractToRef(_hp2, _to);
  _to.y = 0;
  const hl = _to.length();
  if (hl > 1e-4) _to.scaleInPlace(PALM_LEAN / hl);
  _to.y = -1;
  _to.normalize();
  const fix = between(PALM_N[hand as keyof typeof PALM_N], _to);
  if (!hn.rotationQuaternion) hn.rotationQuaternion = Quaternion.Identity();
  _inv.multiplyToRef(fix, _need);
  const need0 = 2 * Math.acos(Math.min(1, Math.abs(_need.w)));
  // ⚠️ 補正を丸ごと手首に入れてはいけない。実測で手首が中央 55°・最大 174° 折れていた。
  //    必要な回転はおよそ 100°。前腕の軸まわりのひねり（回内）で吸収できないか調べたが、
  //    実測でひねり成分は 0.0°。つまり**肩の角度で決まる成分**だった。
  //
  //    肩→手首の直線まわりに腕全体を回すと、肩も手首も軸の上にあるので**手の位置は
  //    動かず**、肘だけが弧を描く。前腕の向き＝手のひらの向きだけが変わるので、
  //    これで手首に残る曲げが最小になる角度を選ぶ。
  // ⚠️ 肩→手首の軸まわりに腕を回して手首の負担を減らす案は入れて外した。実測で
  //    減らせるのは 5°程度（必要角 104° → 99°）しかない一方、肘の位置を勝手に
  //    決めてしまうので「肘を体の外へ出す」指定が効かなくなる。肘の置き場所は
  //    IK の張り出し(DRIB_ELBOW_OUT)に任せる。
  const ang = 2 * Math.acos(Math.min(1, Math.abs(_need.w)));
  if (ang > WRIST_CAP) Quaternion.SlerpToRef(_IDENT, _need, WRIST_CAP / ang, _need);
  hn.rotationQuaternion.copyFrom(_need);
  hn.markAsDirty("rotationQuaternion");
}
