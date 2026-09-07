// 手の握り。ボールに触れている手は開いたまま、それ以外は**胴から遠いほど開き、
// 近いほど握ってグーに近づける**。
//
// ⚠️ 回転はハードコードしない。指を丸める軸は素体の**静止姿勢から**求める
//    （指骨の向き × 手のひらの法線）。向きの符号も、実際に中指の先を回して
//    親指に近づく方を選ぶ。素体が変わっても曲がる向きが逆にならない。
// ⚠️ コートの向き(numberSide)には依存しない。手は素体の左右そのもの。
import { Quaternion, Vector3 } from "@babylonjs/core";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import { clamp, expEase } from "../../util";
import { MOVE_RATE } from "./joints";
import type { Player } from "../../objects/player/player";
import type { VoxelBody } from "../../objects/player/player-voxel";

/** 指の段。手前から順に、丸める量の配分。 */
const SEG: [string, number][] = [["Proximal", 0.85], ["Intermediate", 1.0], ["Distal", 0.75]];
/** 指ごとの丸める量の配分。親指は他の指ほど曲がらない。 */
const FINGER: [string, number][] = [
  ["Index", 1.0], ["Middle", 1.0], ["Ring", 0.95], ["Little", 0.9], ["Thumb", 0.45],
];
/** 握り切ったときの1段あたりの角度(rad ≈ 60°)。3段で約 165°、指先が手のひらへ入る。 */
const FULL = 1.05;
// しきい値は実測から決めた。26人×60秒の「胴から手までの距離」は
// 5% 0.058m / 25% 0.113m / 中央 0.191m / 75% 0.283m / 95% 0.411m。
/** 胴からこの距離(m)までは握り切る。 */
const NEAR = 0.04;
/** 胴からこの距離(m)まで離れたら開き切る。 */
const FAR = 0.32;
/** 開き具合がこれ以下しか動いていないフレームは骨を書き直さない（26人×30本の節約）。 */
const STILL = 0.002;

interface Curl { bone: StandardBoneName; axis: Vector3; amount: number }
/** 素体1体ぶんの、指を丸める軸の表。全員で同じ素体なのでリグ単位で1回だけ作る。 */
const RIGS = new WeakMap<object, Curl[]>();
/** 選手ごとの、いまの握り具合（左右）と、最後に骨へ書いた値。
 *  ⚠️ 30本 × 26人 = 780本を毎フレーム書くのは無駄。動いた側だけ書き直す。 */
const STATE = new WeakMap<Player, { l: number; r: number; wl: number; wr: number }>();

const _v = new Vector3();
/** 確認ページ用の上書き（ゲームでは常に null）。0 = グー / 1 = 開き。 */
let OPEN_OVERRIDE: number | null = null;
export function setGripOverride(v: number | null): void { OPEN_OVERRIDE = v; }
/** いまの開き具合（左右）。確認ページの表示用。 */
export function gripOf(p: Player): { l: number; r: number } {
  const st = STATE.get(p);
  return { l: st ? st.l : 1, r: st ? st.r : 1 };
}

/** a から b への距離。null が混ざったら Infinity。 */
function pos(vb: VoxelBody, b: string): Vector3 | null {
  return vb.rig.restPosition(b as StandardBoneName);
}

/** 手のひらの法線（静止姿勢のリグ空間）。人差し指→小指 と 手首→中指 の外積。 */
function palmNormal(vb: VoxelBody, side: string): Vector3 | null {
  const idx = pos(vb, `${side}IndexProximal`), lit = pos(vb, `${side}LittleProximal`);
  const mid = pos(vb, `${side}MiddleProximal`), hand = pos(vb, `${side}Hand`);
  if (!idx || !lit || !mid || !hand) return null;
  const across = lit.subtract(idx), along = mid.subtract(hand);
  const n = Vector3.Cross(across, along);
  return n.lengthSquared() > 1e-9 ? n.normalize() : null;
}

/** 素体から、指1本1段ぶんの「丸める軸」を組む。 */
function buildCurls(vb: VoxelBody): Curl[] {
  const out: Curl[] = [];
  for (const side of ["Left", "Right"]) {
    const n = palmNormal(vb, side);
    if (!n) continue;
    // 符号: 中指の先を回してみて、親指へ近づく向きを採る（素体依存の決め打ちをしない）。
    let sign = 1;
    const piv = pos(vb, `${side}MiddleProximal`), tip = pos(vb, `${side}MiddleDistal`);
    const thumb = pos(vb, `${side}ThumbDistal`);
    const dirMid = vb.rig.restDirection(`${side}MiddleProximal` as StandardBoneName);
    if (piv && tip && thumb && dirMid) {
      const ax = Vector3.Cross(dirMid, n);
      if (ax.lengthSquared() > 1e-9) {
        ax.normalize();
        const arm = tip.subtract(piv);
        const a = arm.rotateByQuaternionToRef(Quaternion.RotationAxis(ax, 0.9), new Vector3());
        const b = arm.rotateByQuaternionToRef(Quaternion.RotationAxis(ax, -0.9), new Vector3());
        sign = Vector3.Distance(piv.add(a), thumb) <= Vector3.Distance(piv.add(b), thumb) ? 1 : -1;
      }
    }
    for (const [f, fw] of FINGER) {
      // ⚠️ 指先(Distal)は末端なので子が無く、静止方向が取れない（実測で 30本中10本）。
      //    そのままだと第3関節だけ曲がらず、握っても指が半開きのままになる。
      //    1つ手前の段の軸を引き継ぐ（同じ指の3段はほぼ同一平面なので向きは同じ）。
      let prev: Vector3 | null = null;
      for (const [s, sw] of SEG) {
        const bone = `${side}${f}${s}` as StandardBoneName;
        if (!vb.rig.node(bone)) continue;
        const d = vb.rig.restDirection(bone);
        let ax: Vector3 | null = prev;
        if (d) {
          const c = Vector3.Cross(d, n);
          if (c.lengthSquared() >= 1e-9) ax = c.normalize().scale(sign);
        }
        if (!ax) continue;
        prev = ax;
        out.push({ bone, axis: ax, amount: fw * sw });
      }
    }
  }
  return out;
}

/** 点 p から線分 ab までの距離。 */
function distToSeg(p: Vector3, a: Vector3, b: Vector3): number {
  b.subtractToRef(a, _v);
  const l2 = _v.lengthSquared();
  const t = l2 > 1e-9 ? clamp(Vector3.Dot(p.subtract(a), _v) / l2, 0, 1) : 0;
  return Vector3.Distance(p, a.add(_v.scale(t)));
}

/** 片手ぶんの「開き具合」0..1。1 = 開く / 0 = グー。 */
function openFor(vb: VoxelBody, side: string): number {
  const hand = vb.rig.node(`${side}Hand` as StandardBoneName);
  const hips = vb.rig.node("Hips"), neck = vb.rig.node("Neck");
  const sh = vb.rig.node(`${side}UpperArm` as StandardBoneName);
  if (!hand || !hips || !neck || !sh) return 1;
  const a = hips.getAbsolutePosition(), b = neck.getAbsolutePosition();
  // 胴の太さの代わりに肩関節までの距離を使う（素体の実寸から取れる）。
  const half = distToSeg(sh.getAbsolutePosition(), a, b);
  const d = distToSeg(hand.getAbsolutePosition(), a, b) - half;
  return clamp((d - NEAR) / (FAR - NEAR), 0, 1);
}

/**
 * 指のポーズを1フレームぶん書く。
 * **他のポーズを全部書き終えたあと**（skel.prepare の直前）に呼ぶこと。
 */
export function applyFingers(vb: VoxelBody, p: Player): void {
  let curls = RIGS.get(vb.rig);
  if (!curls) { curls = buildCurls(vb); RIGS.set(vb.rig, curls); }
  if (!curls.length) return;
  // ボールに触れている手は開いたまま。ドリブルの手・キャッチの手が対象。
  // ⚠️ palmRight / dribbleArm は**仮想の**左右。骨組みは numberSide が +1 のとき
  //    180° 回っていて左右が入れ替わるので、ここで見た目の側へ直す。
  const back = p.numberSide > 0;
  let ballR = false, ballL = false;   // 見た目の右手／左手
  const mark = (virtualRight: boolean): void => {
    if (virtualRight === !back) ballR = true; else ballL = true;
  };
  if (p.palmBall) { if (p.palmBoth) { mark(true); mark(false); } else mark(p.palmRight); }
  if (p.dribblePosed) mark(p.dribbleArm === "R");
  let st = STATE.get(p);
  if (!st) { st = { l: 1, r: 1, wl: NaN, wr: NaN }; STATE.set(p, st); }
  const tR = OPEN_OVERRIDE ?? (ballR ? 1 : openFor(vb, "Right"));
  const tL = OPEN_OVERRIDE ?? (ballL ? 1 : openFor(vb, "Left"));
  st.r = expEase(st.r, tR, MOVE_RATE.arm, p.lastDt);
  st.l = expEase(st.l, tL, MOVE_RATE.arm, p.lastDt);
  const doL = !(Math.abs(st.l - st.wl) < STILL);
  const doR = !(Math.abs(st.r - st.wr) < STILL);
  if (!doL && !doR) return;
  if (doL) st.wl = st.l;
  if (doR) st.wr = st.r;
  for (const c of curls) {
    const left = c.bone.startsWith("Left");
    if (left ? !doL : !doR) continue;
    const n = vb.rig.node(c.bone);
    if (!n) continue;
    const ang = (1 - (left ? st.l : st.r)) * FULL * c.amount;
    if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.Identity();
    Quaternion.RotationAxisToRef(c.axis, ang, n.rotationQuaternion);
    n.markAsDirty("rotationQuaternion");
  }
}
