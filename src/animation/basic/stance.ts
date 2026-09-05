// 直立度（upright）と、それに応じた構えの姿勢。
//
// 直立度 1.0 = 直立不動（棒立ち）、0.0 = 一番低い構え。下がるほど
//   ・膝と股関節が曲がって腰が沈む
//   ・肩が開いて腕が体から離れる（次の動作へ入れる形）
//   ・わずかに前傾する
// 試合中はボールが自分から遠いほど直立度が上がり、ディフェンスは
// オフェンスより低く構える。
import { Quaternion, Vector3 } from "@babylonjs/core";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import type { Player } from "../../objects/player/player";
import { splayLegs, type VoxelBody } from "../../objects/player/player-voxel";

/** 直立度 0 のときの腿の前傾（rad）。 */
const READY_THIGH = 0.40;      // ≈23°
/** 直立度 0 のときの脛の後傾（rad）。腿より深くして膝を曲げる。 */
const READY_SHIN = 0.52;       // ≈30°
/** 直立度 0 のときの上腕の外向き角（rad）。 */
const READY_SPLAY = 0.40;      // ≈23°
/** 直立度 0 のときの上半身の前傾（rad）。 */
const READY_LEAN = 0.30;       // ≈17°
/** 直立度 0 のときの足の開き（rad、片脚あたり）。 */
const READY_STANCE = 0.17;     // ≈10°
/** 直立度 0 のときの膝の外向き（rad、片脚あたり）。腿を長軸まわりに外へひねる。 */
const READY_KNEE_OUT = 0.32;   // ≈18°
/** 直立度 0 のときの鎖骨の前傾（rad）。肩を前へ入れる。 */
const READY_SHOULDER = 0.14;   // ≈8°
/** 直立度 0 のときの上腕の前傾（rad）。 */
const READY_ARM = 0.34;        // ≈19°
/** 直立度 0 のときの前腕の前傾（rad）。肘を曲げて手を前に出す。 */
const READY_FOREARM = 0.62;    // ≈36°
/** 直立度の追従の速さ（1秒あたりの割合）。急に沈むと不自然。 */
const FOLLOW = 4.0;

// --- 試合中の直立度 --------------------------------------------------------
/** ボールがこの距離より近いと一番低く構える（m）。 */
const NEAR = 2.0;
/** ボールがこの距離より遠いと立ち上がる（m）。 */
const FAR = 9.0;
/** ボールが近いときの直立度。攻める側は少し高め、守る側は低い。 */
const BASE_OFFENSE = 0.55;
const BASE_DEFENSE = 0.25;
/** ボールが遠いときの直立度の上限。⚠️ 守る側は遠くても完全には立たない。 */
const TOP_OFFENSE = 1.00;
const TOP_DEFENSE = 0.85;

/**
 * ボールとの距離・攻守から、その選手の直立度の狙いを決める。
 * ⚠️ ボールを持っている本人は、ドリブルの構えがあるので低めに固定する。
 */
export function uprightTargetFor(p: Player, ballX: number, ballZ: number, onOffense: boolean): number {
  if (p.seated) return 1;
  const base = onOffense ? BASE_OFFENSE : BASE_DEFENSE;
  if (p.holdingBall) return base;
  const top = onOffense ? TOP_OFFENSE : TOP_DEFENSE;
  const d = Math.hypot(p.pos.x - ballX, p.pos.z - ballZ);
  const k = Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
  return base + (top - base) * k;
}

/** 狙いへ滑らかに寄せる。sync から毎フレーム。 */
export function stepUpright(p: Player, dt: number): void {
  const d = Math.min(1, (dt > 0 ? dt : 1 / 60) * FOLLOW);
  p.upright += (p.uprightTarget - p.upright) * d;
}

const _q = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/**
 * ボーンを体の前後方向へ傾ける（今の姿勢の上に重ねる）。
 * ⚠️ 回転は**前掛け**する。ボーンのローカル軸は骨ごとに向きが違うので、親の枠で
 *    掛けないと横へねじれる（splayLegs と同じ規約）。
 * ⚠️ 符号は骨によって違う（脚と胴で逆）。実測で決めること。
 */
function tiltX(vb: VoxelBody, bone: string, ang: number): void {
  if (Math.abs(ang) < 1e-4) return;
  const n = vb.rig.node(bone as StandardBoneName);
  const q = n?.rotationQuaternion;
  if (!n || !q) return;
  Quaternion.RotationAxisToRef(X, ang, _q);
  _q.multiplyToRef(q, q);
  n.markAsDirty("rotationQuaternion");
}

/** ボーンを縦軸まわりにひねる（今の姿勢の上に重ねる）。膝を外へ向けるのに使う。 */
function tiltY(vb: VoxelBody, bone: string, ang: number): void {
  if (Math.abs(ang) < 1e-4) return;
  const n = vb.rig.node(bone as StandardBoneName);
  const q = n?.rotationQuaternion;
  if (!n || !q) return;
  Quaternion.RotationAxisToRef(Y, ang, _q);
  _q.multiplyToRef(q, q);
  n.markAsDirty("rotationQuaternion");
}

/** ボーンを体の左右方向へ倒す（今の姿勢の上に重ねる）。splayLegs の打ち消しに使う。 */
function tiltZ(vb: VoxelBody, bone: string, ang: number): void {
  if (Math.abs(ang) < 1e-4) return;
  const n = vb.rig.node(bone as StandardBoneName);
  const q = n?.rotationQuaternion;
  if (!n || !q) return;
  Quaternion.RotationAxisToRef(Z, ang, _q);
  _q.multiplyToRef(q, q);
  n.markAsDirty("rotationQuaternion");
}

/**
 * 誰も姿勢を書かないボーンを、前後へ傾ける（毎フレーム上書き）。
 * ⚠️ 鎖骨（Shoulder）はアニメの読み替え表に無いので回転が空のまま。重ね掛けだと
 *    毎フレーム積み上がって肩が回り続けるので、静止姿勢からの絶対値で入れる。
 */
function setTiltX(vb: VoxelBody, bone: string, ang: number): void {
  const n = vb.rig.node(bone as StandardBoneName);
  if (!n) return;
  if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.Identity();
  Quaternion.RotationAxisToRef(X, ang, n.rotationQuaternion);
  n.markAsDirty("rotationQuaternion");
}

/** 低いほうの足首のワールド高さ（接地している側）。 */
function lowestFootY(vb: VoxelBody): number {
  let y = Infinity;
  for (const b of ["LeftFoot", "RightFoot"] as StandardBoneName[]) {
    const n = vb.rig.node(b);
    if (!n) continue;
    n.computeWorldMatrix(true);
    y = Math.min(y, n.getAbsolutePosition().y);
  }
  return isFinite(y) ? y : 0;
}

/**
 * 構えをボーンへ重ねる（クリップ／手続きポーズのどちらの上にも掛かる）。
 * ⚠️ 脚を曲げたぶんだけ root を下げないと足が床から浮く（applyShootLoad と同じ扱い）。
 * ⚠️ 回転は**前掛け**する。ボーンのローカル軸は骨ごとに向きが違うので、親の枠で
 *    掛けないと脚が横へねじれる（splayLegs と同じ規約）。
 */
export function applyStance(vb: VoxelBody, p: Player): void {
  const s = 1 - p.upright;
  // 鎖骨は誰も書かないので、直立時に 0 へ戻すためここは早期 return より前に置く。
  setTiltX(vb, "LeftShoulder", -READY_SHOULDER * s);
  setTiltX(vb, "RightShoulder", -READY_SHOULDER * s);
  if (s < 0.01) return;
  // ⚠️ **numberSide（コートのどちら側を向くか）で符号を変えてはいけない。**
  //    ここはボクセルのボーンに直接掛けるので、既に骨組みごとヨーされた「体の枠」の
  //    中にいる。向きで符号を変えると、片側のチームだけ膝が逆関節になる（実測で
  //    numberSide=+1 の選手が -131mm＝後ろへ曲がっていた）。体の枠での向きは1つ。
  const a = READY_THIGH * s;                 // 腿を前へ
  const b = READY_SHIN * s;                  // 脛を後ろへ
  const before = lowestFootY(vb);
  // 脚: 前へ曲げる ＋ 左右に開く
  tiltX(vb, "LeftUpperLeg", -a); tiltX(vb, "RightUpperLeg", -a);
  tiltX(vb, "LeftLowerLeg", a + b); tiltX(vb, "RightLowerLeg", a + b);
  const splay = READY_STANCE * s;
  splayLegs(vb, splay);
  // 膝を外へ向ける（腿を長軸まわりに外へひねる）。つま先も一緒に外を向く。
  // ⚠️ 足裏の水平は崩れない（縦軸まわりなので傾かない）。
  const out = READY_KNEE_OUT * s;
  tiltY(vb, "LeftUpperLeg", -out); tiltY(vb, "RightUpperLeg", out);
  // 足首: 脛の傾きと脚の開きを打ち消して、足裏を地面と平行に保つ。
  // ⚠️ 足首は親から回転をそのまま受け継ぐ。腿 -a と膝 +(a+b) で差し引き +b、
  //    開きは splayLegs が Z 軸に ±splay。同じ量を逆へ掛けて水平へ戻す。
  //    （splayLegs の左右の符号は Left=-1 / Right=+1。そちらに合わせる）
  tiltX(vb, "LeftFoot", -b); tiltX(vb, "RightFoot", -b);
  tiltZ(vb, "LeftFoot", splay); tiltZ(vb, "RightFoot", -splay);
  // 腰を沈める。
  // ⚠️ 縮む量を角度から計算してはいけない。クリップが既に膝を曲げているので、
  //    重ねた角度ぶんだけでは合わない（式で出すと 8.6cm 沈みすぎたり 4.3cm 浮いたりした）。
  //    **曲げる前と後で足首の高さを実測**し、その差だけ下げる。
  p.root.position.y -= lowestFootY(vb) - before;
  // 上半身の前傾。⚠️ 胴は脚と符号が逆。ボーンごとにローカル軸の向きが違う。
  tiltX(vb, "Spine", READY_LEAN * s);
  // 頭: 胴が前傾したぶん起こして、顔は前を向いたままにする。
  tiltX(vb, "Head", -READY_LEAN * s);
  // 肩〜前腕を前へ。すぐ手が出る形にする。
  // ⚠️ 腕は胴と符号が逆（脚と同じ側）。正のまま掛けると腕が後ろへ流れる
  //    （実測で手が体の前 -113mm → -268mm と、逆に後ろへ下がっていた）。
  tiltX(vb, "LeftUpperArm", -READY_ARM * s); tiltX(vb, "RightUpperArm", -READY_ARM * s);
  tiltX(vb, "LeftLowerArm", -READY_FOREARM * s); tiltX(vb, "RightLowerArm", -READY_FOREARM * s);
}

/** 構えに応じた上腕の外向き角の下限。 */
export function armSplayFor(vb: VoxelBody, p: Player): number {
  const s = 1 - p.upright;
  return vb.baseArmSplay + (READY_SPLAY - vb.baseArmSplay) * s;
}
