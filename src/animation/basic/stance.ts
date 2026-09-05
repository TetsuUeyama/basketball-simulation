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

// --- 関節ごとのばらつき ----------------------------------------------------
// ⚠️ 全関節に同じ直立度を渡すと、左右も上下も揃いすぎて機械的に見える。関節ごとに
//    少しずつ違う値をゆっくり揺らす。人ごとに位相と周期が違うので、26人が同じ形に
//    ならない。
/** 揺れの片振幅。実効の直立度は base-2*WOB 〜 base の帯に収まる。 */
const WOB = 0.025;             // 脚・胴は帯 5%（例: 直立度 1.00 なら 0.95〜1.00）
/** 腕はもう少し大きく揺らす。脚と違って接地の制約が無く、動いて見えるほうが自然。 */
const WOB_ARM = 0.05;          // 腕は帯 10%（同 0.90〜1.00）
/** 揺れの遅さ（rad/秒）。ゆっくり漂う速さ。速いと震えて見える。 */
const WOB_HZ_LO = 0.18, WOB_HZ_HI = 0.45;

/** 関節の区分。左右・部位ごとに別々の値を渡す。 */
export const G = {
  thighL: 0, thighR: 1, shinL: 2, shinR: 3, stanceL: 4, stanceR: 5,
  outL: 6, outR: 7, lean: 8, shoulderL: 9, shoulderR: 10,
  armL: 11, armR: 12, foreL: 13, foreR: 14, splay: 15,
} as const;
const NG = 16;
/** 区分ごとの揺れ幅。腕まわり（鎖骨・上腕・前腕・腕の外向き）だけ大きい。 */
const AMP = (() => {
  const a = new Float64Array(NG).fill(WOB);
  for (const i of [G.shoulderL, G.shoulderR, G.armL, G.armR, G.foreL, G.foreR, G.splay]) a[i] = WOB_ARM;
  return a;
})();

type Wobble = { t: number; ph: Float64Array; fr: Float64Array; s: Float64Array };
const WOBBLE = new WeakMap<Player, Wobble>();

function wobbleOf(p: Player): Wobble {
  let w = WOBBLE.get(p);
  if (!w) {
    w = { t: Math.random() * 100, ph: new Float64Array(NG), fr: new Float64Array(NG), s: new Float64Array(NG) };
    for (let i = 0; i < NG; i++) {
      w.ph[i] = Math.random() * Math.PI * 2;
      w.fr[i] = (WOB_HZ_LO + Math.random() * (WOB_HZ_HI - WOB_HZ_LO)) * Math.PI * 2;
    }
    WOBBLE.set(p, w);
  }
  return w;
}

/** 関節 i の「構えの深さ」。0 = 直立、1 = 一番低い。 */
export function stanceS(p: Player, i: number): number {
  const w = WOBBLE.get(p);
  return w ? w.s[i] : 1 - p.upright;
}

/** 狙いへ滑らかに寄せ、関節ごとのばらつきを進める。sync から毎フレーム。 */
export function stepUpright(p: Player, dt: number): void {
  const step = dt > 0 ? dt : 1 / 60;
  p.upright += (p.uprightTarget - p.upright) * Math.min(1, step * FOLLOW);
  const w = wobbleOf(p);
  w.t += step;
  for (let i = 0; i < NG; i++) {
    // 周期の違う波を2つ重ねると、繰り返しが目立たない
    const n = Math.sin(w.t * w.fr[i] + w.ph[i]) * 0.65
      + Math.sin(w.t * w.fr[i] * 1.7 + w.ph[i] * 2.3) * 0.35;
    // 帯の上端を base に合わせる（直立度 1 の選手が 1 を超えないように）
    const w2 = AMP[i];
    const u = Math.min(1, Math.max(0, p.upright - w2 + n * w2));
    w.s[i] = 1 - u;
  }
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
  const S = (i: number): number => stanceS(p, i);
  setTiltX(vb, "LeftShoulder", -READY_SHOULDER * S(G.shoulderL));
  setTiltX(vb, "RightShoulder", -READY_SHOULDER * S(G.shoulderR));
  // ⚠️ **numberSide（コートのどちら側を向くか）で符号を変えてはいけない。**
  //    ここはボクセルのボーンに直接掛けるので、既に骨組みごとヨーされた「体の枠」の
  //    中にいる。向きで符号を変えると、片側のチームだけ膝が逆関節になる（実測で
  //    numberSide=+1 の選手が -131mm＝後ろへ曲がっていた）。体の枠での向きは1つ。
  const aL = READY_THIGH * S(G.thighL), aR = READY_THIGH * S(G.thighR);
  const bL = READY_SHIN * S(G.shinL), bR = READY_SHIN * S(G.shinR);
  const before = lowestFootY(vb);
  // 脚: 前へ曲げる ＋ 左右に開く
  tiltX(vb, "LeftUpperLeg", -aL); tiltX(vb, "RightUpperLeg", -aR);
  tiltX(vb, "LeftLowerLeg", aL + bL); tiltX(vb, "RightLowerLeg", aR + bR);
  const spL = READY_STANCE * S(G.stanceL), spR = READY_STANCE * S(G.stanceR);
  // splayLegs は「両脚共通の量 ＋ 左右差」で受けるので、そこへ寄せる
  const spAvg = (spL + spR) / 2;
  splayLegs(vb, spAvg, spAvg > 1e-6 ? (spL - spR) / (2 * spAvg) : 0);
  // 膝を外へ向ける（腿を長軸まわりに外へひねる）。つま先も一緒に外を向く。
  // ⚠️ 足裏の水平は崩れない（縦軸まわりなので傾かない）。
  tiltY(vb, "LeftUpperLeg", -READY_KNEE_OUT * S(G.outL));
  tiltY(vb, "RightUpperLeg", READY_KNEE_OUT * S(G.outR));
  // 足首: 脛の傾きと脚の開きを打ち消して、足裏を地面と平行に保つ。
  // ⚠️ 足首は親から回転をそのまま受け継ぐ。腿 -a と膝 +(a+b) で差し引き +b、
  //    開きは splayLegs が Z 軸に ±splay。同じ量を逆へ掛けて水平へ戻す。
  //    （splayLegs の左右の符号は Left=-1 / Right=+1。そちらに合わせる）
  tiltX(vb, "LeftFoot", -bL); tiltX(vb, "RightFoot", -bR);
  tiltZ(vb, "LeftFoot", spL); tiltZ(vb, "RightFoot", -spR);
  // 腰を沈める。
  // ⚠️ 縮む量を角度から計算してはいけない。クリップが既に膝を曲げているので、
  //    重ねた角度ぶんだけでは合わない（式で出すと 8.6cm 沈みすぎたり 4.3cm 浮いたりした）。
  //    **曲げる前と後で足首の高さを実測**し、その差だけ下げる。
  p.root.position.y -= lowestFootY(vb) - before;
  // 上半身の前傾。⚠️ 胴は脚と符号が逆。ボーンごとにローカル軸の向きが違う。
  // ⚠️ 頭は胴と**同じ値**を使う。別々に揺らすと打ち消しが狂って顔が上下する。
  const lean = READY_LEAN * S(G.lean);
  tiltX(vb, "Spine", lean);
  // 頭: 胴が前傾したぶん起こして、顔は前を向いたままにする。
  tiltX(vb, "Head", -lean);
  // 肩〜前腕を前へ。すぐ手が出る形にする。
  // ⚠️ 腕は胴と符号が逆（脚と同じ側）。正のまま掛けると腕が後ろへ流れる
  //    （実測で手が体の前 -113mm → -268mm と、逆に後ろへ下がっていた）。
  tiltX(vb, "LeftUpperArm", -READY_ARM * S(G.armL)); tiltX(vb, "RightUpperArm", -READY_ARM * S(G.armR));
  tiltX(vb, "LeftLowerArm", -READY_FOREARM * S(G.foreL));
  tiltX(vb, "RightLowerArm", -READY_FOREARM * S(G.foreR));
}

/** 構えに応じた上腕の外向き角の下限。 */
export function armSplayFor(vb: VoxelBody, p: Player): number {
  return vb.baseArmSplay + (READY_SPLAY - vb.baseArmSplay) * stanceS(p, G.splay);
}
