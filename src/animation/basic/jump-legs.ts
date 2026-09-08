// ジャンプ中の脚に、選手ごとの癖と1回ごとのばらつきを重ねる。
//
// ⚠️ 焼き込みクリップだけだと左右の脚がまったく同じに動く。実測（3試合・滞空
//    6,919 フレーム）で左右の差は 膝 0.6°・腿 1.4° しかなく、人形のように見えていた。
//    脚そのものは動いている（1回のジャンプで合計 390°、静止フレーム 0%）ので、
//    足りないのは動きの量ではなく**左右差と個人差**。
//
// 腕（arm-style.ts）と同じ考え方で、
//   ・体幹に近い方から先に動かす（腿 → 脛）
//   ・終わりは急に止めず、着地の立て直しにかけて 0 へ戻す
// を守って重ねる。
import { Quaternion, Vector3 } from "@babylonjs/core";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import { clamp } from "../../util";
import type { Player } from "../../objects/player/player";
import type { VoxelBody } from "../../objects/player/player-voxel";

/** 片脚をどれだけ多く畳むか(rad)の幅。0 = 左右そっくり（いままで）。 */
const TUCK = 0.46;
/** 腿の前後差(rad)の幅。片脚を前へ、もう片脚を後ろへ残す。 */
const SWING = 0.34;
/** 膝を外/内へ振る差(rad)の幅。 */
const SPLAY = 0.18;
/** 脛が腿から遅れる割合。1 = 同時、小さいほど遅れて効く。 */
const SHIN_LAG = 0.55;
/** 立ち上がり・終わりの丸め。0..1 の進みに掛ける。 */
const smooth = (t: number): number => t * t * (3 - 2 * t);

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();

/** 今の姿勢の上に、軸まわりの回転を重ねる。 */
function tilt(vb: VoxelBody, bone: string, axis: Vector3, ang: number): void {
  if (Math.abs(ang) < 1e-4) return;
  const n = vb.rig.node(bone as StandardBoneName);
  const q = n?.rotationQuaternion;
  if (!n || !q) return;
  Quaternion.RotationAxisToRef(axis, ang, _q);
  _q.multiplyToRef(q, q);
  n.markAsDirty("rotationQuaternion");
}

/** 名前 → 32bit ハッシュ（FNV-1a）。選手ごとの癖を毎試合同じにする。 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

interface Style { tuck: number; swing: number; splay: number }
/** 選手ごとの癖（名前で決まる）。 */
const CACHE = new Map<string, Style>();
function styleFor(p: Player): Style {
  const hit = CACHE.get(p.name);
  if (hit) return hit;
  let x = hash(p.name) || 1;
  const r = (): number => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const st: Style = { tuck: r() * 2 - 1, swing: r() * 2 - 1, splay: r() * 2 - 1 };
  CACHE.set(p.name, st);
  return st;
}

/** ジャンプ1回ごとの状態。踏み切りで引き直し、着地の立て直しで 0 へ戻す。 */
interface Take { tuck: number; swing: number; splay: number; w: number }
const TAKE = new WeakMap<Player, Take>();

/**
 * ジャンプ中の脚に癖を重ねる。**クリップと構えを当てたあと**に呼ぶこと。
 * 着地後も立て直し（landT）の間は残り、0 へ戻してから消える。
 */
export function applyJumpLegs(vb: VoxelBody, p: Player): void {
  let t = TAKE.get(p);
  if (p.airborne) {
    // 踏み切りの瞬間だけ引き直す（滞空中に値が変わると脚がぶれる）
    if (!t || t.w < 0) {
      const st = styleFor(p);
      // 選手の癖を土台に、1回ごとに少し振る。⚠️ ここで Math.random を使うと
      // リプレイのたびに変わるので、跳んだ時刻と選手番号から決める。
      let x = (hash(p.name) ^ Math.imul(Math.round(p.jumpDur * 1000) + p.idx, 0x9e3779b9)) >>> 0;
      const r = (): number => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
      const mix = (base: number): number => clamp(base * 0.65 + (r() * 2 - 1) * 0.35, -1, 1);
      t = { tuck: mix(st.tuck), swing: mix(st.swing), splay: mix(st.splay), w: 0 };
      TAKE.set(p, t);
    }
    // 滞空の進み: 立ち上がりで入り、着地に向けて戻す（山なり）
    const k = p.jumpDur > 0 ? clamp(1 - p.jumpRemaining / p.jumpDur, 0, 1) : 0;
    t.w = smooth(clamp(k / 0.25, 0, 1)) * (1 - smooth(clamp((k - 0.6) / 0.4, 0, 1)) * 0.7);
  } else if (t) {
    // 着地の立て直し中は残りを 0 へ。急に消すと足が跳ねる。
    if (p.landT > 0 && p.landDur > 0) t.w *= clamp(p.landT / p.landDur, 0, 1);
    else t.w = 0;
    if (t.w < 0.01) { TAKE.delete(p); return; }
  } else return;

  const w = t.w;
  if (w < 0.01) return;
  // 腿が先、脛は遅れて効く（体幹に近い方から）
  const wt = w, ws = w * SHIN_LAG;
  // 片脚を多く畳む
  tilt(vb, "LeftLowerLeg", X, -TUCK * t.tuck * ws);
  tilt(vb, "RightLowerLeg", X, TUCK * t.tuck * ws);
  // 腿の前後差
  tilt(vb, "LeftUpperLeg", X, SWING * t.swing * wt);
  tilt(vb, "RightUpperLeg", X, -SWING * t.swing * wt);
  // 膝の向き（外/内）
  tilt(vb, "LeftUpperLeg", Y, SPLAY * t.splay * wt);
  tilt(vb, "RightUpperLeg", Y, SPLAY * t.splay * wt);
  void Z;
}
