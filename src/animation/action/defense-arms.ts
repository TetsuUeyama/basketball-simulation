// ディフェンス度（0..1）と、それに応じた守備の腕。
//
// ハンドラーに近いほど 1 に近づき、腕を大きく広げる。広げ方は3つ:
//   ・上（シュートブロックに備える）
//   ・横（進路を塞ぐ）
//   ・相手の方へ（前に進ませない）
// ⚠️ 左右の腕は**別々に**混ぜる。同じ形を左右に出すと機械的に見えるし、実際の守備も
//    片手を上げてもう片手を横、という形が多い。
import { Vector3 } from "@babylonjs/core";
import type { Player } from "../../objects/player/player";

/** この距離より近いと一番強く構える（m）。 */
const NEAR = 1.0;
/** この距離より遠いと守備の腕をやめる（m）。 */
const FAR = 4.5;
/** 追従の速さ（1秒あたり）。 */
const FOLLOW = 3.5;
/** 混ぜ方が入れ替わる速さ（rad/秒）。ゆっくり移ろう。 */
const MIX_HZ_LO = 0.10, MIX_HZ_HI = 0.28;

/** ハンドラーとの距離から守備度を決める。守る側でなければ 0。 */
export function defenseTargetFor(p: Player, handler: Player | null): number {
  if (!handler || p === handler || p.team === handler.team || p.seated || p.airborne) return 0;
  const d = Math.hypot(p.pos.x - handler.pos.x, p.pos.z - handler.pos.z);
  return Math.min(1, Math.max(0, (FAR - d) / (FAR - NEAR)));
}

/** 狙いへ滑らかに寄せる。sync から毎フレーム。 */
export function stepDefense(p: Player, dt: number): void {
  const step = dt > 0 ? dt : 1 / 60;
  p.defense += (p.defenseTarget - p.defense) * Math.min(1, step * FOLLOW);
}

// --- 左右それぞれの混ぜ方 ---------------------------------------------------
type Mix = { t: number; ph: number[]; fr: number[] };
const MIX = new WeakMap<Player, Mix>();
function mixOf(p: Player): Mix {
  let m = MIX.get(p);
  if (!m) {
    m = { t: Math.random() * 100, ph: [], fr: [] };
    for (let i = 0; i < 6; i++) {           // 左右 × 上/横/相手
      m.ph.push(Math.random() * Math.PI * 2);
      m.fr.push((MIX_HZ_LO + Math.random() * (MIX_HZ_HI - MIX_HZ_LO)) * Math.PI * 2);
    }
    MIX.set(p, m);
  }
  return m;
}

/**
 * 腕1本ぶんの重み（上・横・相手）を返す。合計 1。
 * ⚠️ 三択で切り替えると腕が飛ぶ。3つの波を正の値にしてから正規化し、混ざった形で
 *    ゆっくり移ろわせる。
 */
function weights(p: Player, right: boolean, bias: [number, number, number]): [number, number, number] {
  const m = mixOf(p);
  const o = right ? 3 : 0;
  const w: [number, number, number] = [0, 0, 0];
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const n = Math.sin(m.t * m.fr[o + i] + m.ph[o + i]) * 0.5 + 0.5;   // 0..1
    const v = Math.max(0.02, n * n * bias[i]);
    w[i] = v; sum += v;
  }
  for (let i = 0; i < 3; i++) w[i] /= sum;
  return w;
}

/** ミックスの時計を進める（毎フレーム1回）。 */
export function stepDefenseMix(p: Player, dt: number): void {
  mixOf(p).t += dt > 0 ? dt : 1 / 60;
}

const _dir = new Vector3();

/**
 * 守備の腕を作る。左右それぞれ「上・横・相手の方」を混ぜて向ける。
 * @param toward 相手（ハンドラー）の胸のあたり（ワールド）
 * @param shootRisk 0..1 シュートの気配。高いほど「上」に寄る。
 * @param driveRisk 0..1 ドライブの気配。高いほど「相手の方」に寄る。
 */
export function defenseArms(p: Player, toward: Vector3, shootRisk: number, driveRisk: number,
                            rate: number): void {
  const k = p.defense;
  if (k < 0.02) return;
  p.armRateCap = rate;
  const bias: [number, number, number] = [
    0.35 + shootRisk * 1.6,          // 上
    0.55 + (1 - driveRisk) * 0.5,    // 横
    0.35 + driveRisk * 1.5,          // 相手の方
  ];
  for (const right of [false, true]) {
    const pivot = right ? p.armPivotR : p.armPivotL;
    const elbow = right ? p.elbowR : p.elbowL;
    const out = right ? 1 : -1;                    // 体の外向き（root ローカル）
    const w = weights(p, right, bias);
    // 相手の方向を root ローカルへ（aimArm と同じ変換）
    const th = p.root.rotation.y + p.torsoTwist;
    const c = Math.cos(th), s = Math.sin(th);
    const px = pivot.position.x, py = pivot.position.y * p.root.scaling.y, pz = pivot.position.z;
    const sx = p.root.position.x + (c * px + s * pz);
    const sy = p.root.position.y + py;
    const sz = p.root.position.z + (-s * px + c * pz);
    const wx = toward.x - sx, wy = toward.y - sy, wz = toward.z - sz;
    const tx = c * wx - s * wz, ty = wy, tz = s * wx + c * wz;
    const tl = Math.hypot(tx, ty, tz) || 1;
    // 3つの向きを重みで混ぜる
    _dir.set(
      w[0] * out * 0.30 + w[1] * out * 1.00 + w[2] * (tx / tl),
      w[0] * 1.00 + w[1] * 0.25 + w[2] * (ty / tl),
      w[0] * 0.0 + w[1] * 0.0 + w[2] * (tz / tl),
    );
    // ⚠️ 腕を体の反対側へ回さない。「相手の方」の重みが勝つと、相手が正面に居る
    //    ときに手が体を横切って逆側へ出た（実測で右手が x=-232mm）。自分の側に留める。
    if (_dir.x * out < 0) _dir.x = 0;
    // 守備度で「垂らした腕」から混ぜ込む。近いほど大きく広げる。
    _dir.normalize();
    p.setArmDir(pivot, _dir.x * k, _dir.y * k + (1 - k) * -1, _dir.z * k);
    // 上へ伸ばす・相手へ突き出すほど肘は伸ばす。横は少し曲げて構える。
    p.bendElbow(elbow, (0.28 * (1 - k)) + k * (0.05 + w[1] * 0.35));
  }
  p.armRateCap = 0;
}
