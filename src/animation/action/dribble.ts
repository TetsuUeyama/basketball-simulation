// ドリブルアクションのアニメ: ボール側の手で運ぶ。basic/arms のムーバ経由で動く。
import { Vector3, Quaternion, Matrix } from "@babylonjs/core";
import { Player } from "../../objects/player/player";
import type { VoxelBody } from "../../objects/player/player-voxel";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import { armStyleFor } from "../basic/arm-style";

declare module "../../objects/player/player" {
  interface Player {
    reachDribble(world: Vector3, useRight: boolean, rate?: number, guardAt?: Vector3 | null): void;
    /** このフレームでドリブルの手を作った（sync が手のひらを水平に均すのに使う）。 */
    dribblePosed: boolean;
  }
}
Player.prototype.dribblePosed = false;

/** 相手を寄せ付けない腕の伸ばし具合。0.5 でほぼ伸ばし切り。 */
const GUARD_ELBOW = 0.5;
/** 空いている手が相手へ向く距離（m）。これより遠ければ普通に腕を振る。 */
export const GUARD_RANGE = 1.9;

/** ボールがある側と同じ側の手でドリブル/保持する — 左腰へ運んだボールは右腕を
 *  体を横切って（越えて）伸ばすのではなく左手で持つ、そしてその逆も。 */
Player.prototype.reachDribble = function(
  world: Vector3, useRight: boolean, rate = 0, guardAt: Vector3 | null = null,
): void {
    this.dribbleArm = useRight ? "R" : "L";
    this.dribblePosed = true;
    const near = useRight ? this.armPivotR : this.armPivotL;
    const nearElbow = useRight ? this.elbowR : this.elbowL;
    const far = useRight ? this.armPivotL : this.armPivotR;
    const farElbow = useRight ? this.elbowL : this.elbowR;
    this.armRateCap = rate;   // > 0 → 手はドリブル精度の速度で置き直す
    this.aimArm(near, world);
    this.bendElbow(nearElbow, 0);   // 前腕がボールへ向かって伸びる、イーズ
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
// ⚠️ 静止姿勢での手のひらの法線はメッシュから実測した（手の指先寄りの頂点で、
//    ばらつきが最小の向き＝板の法線）。左 (0.263,-0.904,-0.338)、右 (-0.279,-0.885,-0.373)。
//    真下から 25° ずれているので、その差も一緒に入れる。
const PALM_N = {
  LeftHand: new Vector3(0.263, -0.904, -0.338),
  RightHand: new Vector3(-0.279, -0.885, -0.373),
};
const DOWN = new Vector3(0, -1, 0);
const _m = new Matrix();
const _rot = new Quaternion();
const _inv = new Quaternion();
const _fix: Record<string, Quaternion> = {};

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
  an.getWorldMatrix().multiplyToRef(Matrix.Invert(vb.root.getWorldMatrix()), _m);
  _m.decompose(undefined, _rot, undefined);
  _rot.conjugateToRef(_inv);
  let fix = _fix[hand];
  if (!fix) { fix = between(PALM_N[hand as keyof typeof PALM_N], DOWN); _fix[hand] = fix; }
  if (!hn.rotationQuaternion) hn.rotationQuaternion = Quaternion.Identity();
  _inv.multiplyToRef(fix, hn.rotationQuaternion);
  hn.markAsDirty("rotationQuaternion");
}
