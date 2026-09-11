// 選手の見た目（ボクセル素体の生成・見た目の反映・背番号の向き・メッシュ同期・
// ネームタグ描画・ユニフォーム再着色）。プロトタイプ拡張で Player に紐づけ。

import { HUD_OPTS, uniformOf } from "../../config";
import { clamp, expEase } from "../../util";
import { Player } from "./player";
import { Quaternion, Vector3 } from "@babylonjs/core";
import { applyUpright, buildVoxelBody, syncVoxelPose, type VoxelBody } from "./player-voxel";
import { applyClipPose } from "../../animation/voxel-motion";
import { buildRawVoxelBody, rawReady, useRawFor } from "./player-raw";
import { applyStance, armSplayFor, stepUpright } from "../../animation/basic/stance";
import { levelDribbleHand } from "../../animation/action/dribble";
import { stepDefense, stepDefenseMix } from "../../animation/action/defense-arms";
import { aimPalms, releaseHands } from "../../animation/action/palm";
import { armStyleFor } from "../../animation/basic/arm-style";
import { applyFingers } from "../../animation/basic/fingers";
import { applyJumpLegs } from "../../animation/basic/jump-legs";

declare module "./player" {
  interface Player {
    applyLook(): void;
    setNumberSide(sign: number): void;
    setJerseyMark(text: string, color: string): void;
    sync(): void;
    drawNameTag(): void;
    applyUniform(): void;
    setNameTagVisible(v: boolean): void;
    ensureVoxel(): void;
    rebuildVoxel(): void;
    syncVoxel(): void;
  }
}

/** ボクセルの見た目を（まだ無ければ）組む。 */
Player.prototype.ensureVoxel = function(): void {
    if (this.vox || Player.HEADLESS) return;
    const u = this.kitOverride ?? uniformOf(this.team);
    // 生ボクセルの素体。読み込みが間に合っていなければ従来の経路へ落ちる。
    if (rawReady() && useRawFor()) {
      this.vox = buildRawVoxelBody(this.scene, this.root, {
        name: `${this.team}_${this.idx}`,
        balance: this.attr.balance,
        height: this.height,
        weight: this.weight,
        skin: this.look.skin,
        hair: this.look.hair,
        hairNo: this.look.hairNo,
        kit: { top: u.top, bottom: u.bottom, shoes: u.shoes },
        jerseyText: this.jerseyText,
      });
    }
    if (!this.vox) this.vox = buildVoxelBody(this.scene, this.root, {
      name: `${this.team}_${this.idx}`,
      balance: this.attr.balance,
      height: this.height,
      skin: this.look.skin,
      hair: this.look.hair,
      hairNo: this.look.hairNo,
      kit: { top: u.top, bottom: u.bottom, shoes: u.shoes },
      jerseyText: this.jerseyText,
    });
    // 肩の位置・腕の長さ・股関節の高さを素体の実測値へ合わせる（aimArm / reachIK が使う）
    const v = this.vox;
    // ⚠️ z に Math.abs を掛けてはいけない。素体の肩が体の**後ろ**寄りにあると、
    //    符号を潰したぶん前後が逆になり、仮想の肩とボクセルの肩が 78mm ずれる。
    //    そのぶん IK が置いた手も同じだけずれ、ボールを掴んだ形が手前で止まっていた。
    //    （焼き込み素体は肩が前寄りなので、符号を残しても今までどおり前へ出る）
    this.armPivotL.position.set(v.shoulder.x, v.shoulder.y, -this.numberSide * v.shoulder.z);
    this.armPivotR.position.set(-v.shoulder.x, v.shoulder.y, -this.numberSide * v.shoulder.z);
    this.elbowL.position.y = this.elbowR.position.y = -v.upperArm;
    this.wristL.position.y = this.wristR.position.y = -v.foreArm;
    this.upperArmLen = v.upperArm;
    this.foreArmLen = v.foreArm;
    if (this.sideApplied) this.setNumberSide(this.numberSide);
};

/** 身長・体格が変わったときに作り直す（骨組みごと組み直すため）。 */
Player.prototype.rebuildVoxel = function(): void {
    if (!this.vox) return;
    this.vox.dispose();
    this.vox = null;
    this.ensureVoxel();
};

// ───────────────────────── 姿勢の繋ぎ ─────────────────────────
// ⚠️ クリップの切り替えも、クリップ⇄手続きポーズの切り替えも、これまでは**即座に**
//    差し替えていた。前の姿勢と次の姿勢は当然別物なので、モーションが唐突に始まり
//    唐突に終わって見える。切り替わった瞬間の姿勢を控えて、そこから数フレームかけて
//    新しい姿勢へ寄せる。IK ではなく姿勢の混ぜ合わせ（クロスフェード）で直す。
const POSE_BLEND = 0.14;        // 繋ぎに使う時間（秒）

type PoseState = {
  mode: string;                 // いま流している姿勢の識別子（クリップ名 / "" は手続き）
  t: number;                    // 繋ぎの進み（0→1）
  prevQ: Map<string, Quaternion>;   // 1フレーム前の姿勢
  prevP: Map<string, Vector3>;
  fromQ: Map<string, Quaternion>;   // 繋ぎの起点（切り替わった瞬間の姿勢）
  fromP: Map<string, Vector3>;
};
const POSE = new WeakMap<Player, PoseState>();
const _bq = new Quaternion();

/**
 * 切り替わりの直後だけ、前の姿勢から新しい姿勢へ寄せる。
 * ⚠️ 切り替えに気づいた時点で rig には**もう新しい姿勢**が入っている。前の姿勢は
 *    毎フレーム控えておいたものを使う。
 */
function blendPose(p: Player, vb: VoxelBody, mode: string, dt: number): void {
  let st = POSE.get(p);
  if (!st) {
    st = { mode, t: 1, prevQ: new Map(), prevP: new Map(), fromQ: new Map(), fromP: new Map() };
    POSE.set(p, st);
  }
  if (mode !== st.mode) {
    st.mode = mode;
    st.t = 0;
    st.fromQ = new Map(st.prevQ);
    st.fromP = new Map(st.prevP);
  }
  if (st.t < 1) {
    st.t = Math.min(1, st.t + (dt > 0 ? dt : 1 / 60) / POSE_BLEND);
    // なめらかに入って抜ける（等速だと繋ぎ目が見える）
    const w = 1 - (st.t * st.t * (3 - 2 * st.t));
    if (w > 0.001) {
      for (const b of vb.rig.bones) {
        const n = vb.rig.node(b);
        if (!n) continue;
        const q0 = st.fromQ.get(b);
        if (q0 && n.rotationQuaternion) {
          Quaternion.SlerpToRef(n.rotationQuaternion, q0, w, _bq);
          n.rotationQuaternion.copyFrom(_bq);
        }
        const p0 = st.fromP.get(b);
        if (p0) Vector3.LerpToRef(n.position, p0, w, n.position);
      }
    }
  }
  // 次のフレームのために今の姿勢を控える
  for (const b of vb.rig.bones) {
    const n = vb.rig.node(b);
    if (!n) continue;
    if (n.rotationQuaternion) {
      const c = st.prevQ.get(b);
      if (c) c.copyFrom(n.rotationQuaternion); else st.prevQ.set(b, n.rotationQuaternion.clone());
    }
    const c2 = st.prevP.get(b);
    if (c2) c2.copyFrom(n.position); else st.prevP.set(b, n.position.clone());
  }
}

// ───────────────────────── 関節の速さの上限 ─────────────────────────
// ⚠️ 姿勢を作る経路がいくつもあり（クリップ・手続きポーズ・IK・構え・手のひらの向き）、
//    どこかで補間を通し忘れると関節が1フレームで飛ぶ。個別に直すときりが無いので、
//    **最後にまとめて**速さの上限を掛ける。
// 実測（26人・90秒・93万標本の1フレーム回転量）:
//   50% 0.3° / 90% 4.5° / 99% 16.9° / 99.9% 37.6° / 99.99% 80.1° / 最大 131.9°
//   普通の動き（走り・シュート）は 99% が 17° 以内。上位 1% の 80〜132° が「飛び」。
const MAX_BONE_RATE = (30 * 60) * Math.PI / 180;   // 1800度/秒（60fps で 30°/フレーム）
const BONE_PREV = new WeakMap<Player, Map<string, Quaternion>>();
const _lim = new Quaternion();
function limitBoneRate(p: Player, vb: VoxelBody): void {
  let st = BONE_PREV.get(p);
  if (!st) { st = new Map(); BONE_PREV.set(p, st); }
  const maxA = MAX_BONE_RATE * (p.lastDt > 0 ? p.lastDt : 1 / 60);
  for (const b of vb.rig.bones) {
    const n = vb.rig.node(b);
    const q = n?.rotationQuaternion;
    if (!n || !q) continue;
    const o = st.get(b as string);
    if (!o) { st.set(b as string, q.clone()); continue; }
    const ang = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(o, q))));
    if (ang > maxA) {
      Quaternion.SlerpToRef(o, q, maxA / ang, _lim);
      q.copyFrom(_lim);
      n.markAsDirty("rotationQuaternion");
    }
    o.copyFrom(q);
  }
}

/** 姿勢をボクセルの標準ボーンへ流す（sync から毎フレーム）。
 *  歩く・走る・ドリブルは objcts/player/motion の焼き込みクリップ、それ以外は手続きポーズ。 */
Player.prototype.syncVoxel = function(): void {
    const vb = this.vox;
    if (!vb) return;
    this.updateWristTrail();   // 手首は肩・肘が決まったあとに追従させる
    // 構え（直立度）。腕の開きは姿勢を作る前に、脚の曲げは作ったあとに重ねる。
    stepUpright(this, this.lastDt);
    stepDefense(this, this.lastDt);
    stepDefenseMix(this, this.lastDt);
    vb.armSplay = armSplayFor(vb, this);
    // 選手ごとの「体への寄り」ぶんだけ脇を詰める。下限は素体の値（腕が胴へ埋まる）。
    {
      const st = armStyleFor(this);
      vb.armSplayL = Math.max(vb.baseArmSplay, vb.armSplay - st.inL);
      vb.armSplayR = Math.max(vb.baseArmSplay, vb.armSplay - st.inR);
    }
    if (applyClipPose(vb, this, this.lastDt)) {
      applyStance(vb, this);
      applyJumpLegs(vb, this);   // ジャンプの脚の癖（クリップ・構えの上に重ねる）
      // ⚠️ 手のひらは最後に決める。前腕を動かしたあとでないと打ち消せない。
      if (this.dribblePosed) levelDribbleHand(vb, this);
      if (this.palmBall) aimPalms(vb, this); else releaseHands(this, vb);
      applyUpright(vb, this.reflexTiltX, this.reflexTiltZ, UPRIGHT_SIGN);
      blendPose(this, vb, this.clipName, this.lastDt);
      limitBoneRate(this, vb);
      applyFingers(vb, this);   // 指は最後（他のポーズを全部書き終えてから）
      vb.skel.prepare();
      this.dribblePosed = false;
      this.palmBall = null;
      return;
    }
    syncVoxelPose(vb, {
      numberSide: this.numberSide,
      torsoYaw: this.torsoNode.rotation.y,
      torsoPitch: this.torsoNode.rotation.x,
      torsoOffsetY: this.torsoNode.position.y,
      torsoOffsetZ: this.torsoNode.position.z,
      headYaw: this.headNode.rotation.y,
      headPitch: this.headPitch,
      armL: this.armPivotL, armR: this.armPivotR,
      elbowL: this.elbowL, elbowR: this.elbowR,
      wristL: this.wristL, wristR: this.wristR,
      ikL: this.ikL, ikR: this.ikR,
      hipL: this.hipL, hipR: this.hipR,
      kneeL: this.kneeL, kneeR: this.kneeR,
    });
    applyStance(vb, this);
    applyJumpLegs(vb, this);   // ジャンプの脚の癖（クリップ・構えの上に重ねる）
    if (this.dribblePosed) levelDribbleHand(vb, this);
    if (this.palmBall) aimPalms(vb, this); else releaseHands(this, vb);
    applyUpright(vb, this.reflexTiltX, this.reflexTiltZ, UPRIGHT_SIGN);
    blendPose(this, vb, "", this.lastDt);
    limitBoneRate(this, vb);
    applyFingers(vb, this);   // 指は最後（他のポーズを全部書き終えてから）
    vb.skel.prepare();   // ノードのリグ → スケルトン（服のスキニング）
    this.dribblePosed = false;
    this.palmBall = null;
};

  /** このスロットを今占有する選手のために、見た目（肌/髪色・髪型）を再適用する。
   *  ロースター入替（applyDef）で呼ばれる。 */
Player.prototype.applyLook = function(): void {
    const look = this.look;
    this.vox?.setSkinColor(look.skin);
    this.vox?.setHairColor(look.hair);
    this.vox?.setHairStyle(look.hairNo);
};

  /** 指定のZサイド(+1 / -1)に背番号を向ける — 選手の背中側、すなわち攻めるバスケット
   *  から遠い側。ハーフタイムで反転する。ボクセルは骨組みごと 180° 回して前後を
   *  入れ替えるので、背番号のシェルは1枚でよい。 */
Player.prototype.setNumberSide = function(sign: number): void {
    this.sideApplied = true;
    this.numberSide = sign >= 0 ? 1 : -1;
    this.vox?.setNumberVisible(true);
    // 肩はわずかに前寄り（前 = -numberSide·Z）
    const shz = this.vox ? this.vox.shoulder.z : 0.01;   // ⚠️ 符号を潰さない（上の注意）
    this.armPivotL.position.z = -this.numberSide * shz;
    this.armPivotR.position.z = -this.numberSide * shz;
};

  /** 背番号デカールを任意の文字（指定色）に差し替える。
   *  審判用: 背番号の代わりに大きな極太の「R」。 */
Player.prototype.setJerseyMark = function(text: string, color: string): void {
    this.jerseyText = text;
    this.vox?.setJerseyText(text, color);
    this.setNumberSide(this.numberSide || 1);
};

// 加速の反動の強さ: 加速度1 m/s^2 あたりの傾き(rad)と、その上限(rad ≈ 11°)。
const ACC_TILT = 0.015, ACC_TILT_MAX = 0.16;
// 反射の傾きを上半身で打ち消す向き。⚠️ probe-upright で実測して決める。
const UPRIGHT_SIGN = 1;   // 実測: +1 で胴・頭が 2.9°/1.2° のまま。-1 だと傾きが倍になる
// 切り返し・急停止のプラント中に、流れていた進行方向へ倒れる量(rad ≈ 13°)。
// ⚠️ シムは方向転換を1フレームで済ませ、減速を経ない。だから加速度からは踏ん張りが
//    出てこない(実測: プラント中に進行方向と逆へ倒れたのは 7% だけ)。plantT から直接出す。
const PLANT_TILT = 0.23;

Player.prototype.sync = function(): void {
    if (this.seated) {
      // リグを下げて腰がベンチ座面に合うようにする。畳んだ脚は前で床に届く。
      // rotation.y は benchIdle/faceToward が設定する — それを保つ。直立のまま（傾きなし）。
      const rootY = this.vox ? Player.SEAT_HIP - this.vox.hipY : Player.SEAT_HIP - Player.HIP_Y;
      this.root.position.set(this.pos.x, rootY + this.jumpY(), this.pos.z);
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this.tiltX = this.tiltZ = 0;
      this.syncVoxel();
      return;
    }
    this.root.position.set(this.pos.x, this.jumpY(), this.pos.z);
    // 見える体の傾き: 姿全体を確定した重心へ傾ける。ワールドの傾きベクトルを規約
    // （RotationY(θ)がローカル+Zを(sinθ,0,cosθ)へ対応、faceToward参照）でヨーローカル
    // フレームへ変換し、rootをピッチ/ロールする。平滑化する。
    const m = this.lean * 0.30;                     // フルの傾きで最大~17°
    // 加速の反動。空中では踏ん張れないので効かせない。踏み出しは進む方へ、
    // 急停止・切り返しは加速度が進行方向と逆を向くので**逆へ倒れる**＝踏ん張りに見える。
    let ax = 0, az = 0;
    if (!this.airborne) {
      const al = Math.hypot(this.accX, this.accZ);
      if (al > 0.5) {
        const g = Math.min(al * ACC_TILT, ACC_TILT_MAX) / al;
        ax = this.accX * g; az = this.accZ * g;
      }
      // 切り返し/急停止の踏ん張り: 足が先に前へ出て、体は**進行方向と逆**へ倒れる
      // （急停止でのけぞる形）。plantT が減る＝重心が足の上へ戻るにつれ起き上がる。
      // ⚠️ 符号に注意。元の進行方向へ倒すと「流れているだけ」に見えて反動にならない。
      if (this.plantT > 0 && this.plantDur > 0) {
        const k = (this.plantT / this.plantDur) * PLANT_TILT;
        ax -= this.plantDirX * k; az -= this.plantDirZ * k;
      }
      // 突き(スティール)の踏み込み。digReach が毎フレーム入れ、ここで消費する。
      ax += this.digLeanX; az += this.digLeanZ;
      this.digLeanX = this.digLeanZ = 0;
    }
    // ワールドの傾きベクトル → ヨーローカルのピッチ/ロール。
    // ⚠️ 反射ぶん(ax,az)は別に持っておく。下半身はこの角度で傾け、上半身は同じだけ
    //    逆へ回して頭を水平に保つ（applyUpright）。守備の重心移動(m)は体ごと傾ける。
    const th = this.root.rotation.y;
    const cc = Math.cos(th), ss = Math.sin(th);
    const toLocal = (wx: number, wz: number): { x: number; z: number } => {
      const lx = wx * cc - wz * ss, lz = wx * ss + wz * cc;
      return { x: lz, z: -lx };                     // ピッチ=ローカル+Z / ロール=ローカル+X
    };
    const all = toLocal(this.leanAxisX * m + ax, this.leanAxisZ * m + az);
    const ref = toLocal(ax, az);
    this.tiltX += (all.x - this.tiltX) * 0.25;
    this.tiltZ += (all.z - this.tiltZ) * 0.25;
    this.reflexTiltX += (ref.x - this.reflexTiltX) * 0.25;
    this.reflexTiltZ += (ref.z - this.reflexTiltZ) * 0.25;
    this.root.rotation.x = this.tiltX + this.flinchPitch;   // + ファウルひるみの後ろへのけぞり
    this.root.rotation.z = this.tiltZ + this.flinchRoll;
    // シュートの溜め姿勢（前傾＋沈み込み）を反映。target は updateCharge が毎フレーム
    // 設定し、リリース後は0へ戻るので自動で伸び上がる。
    // ⚠️ 体幹は腕より**速く**動かす。同じか遅いと、伸び上がりより先に腕が伸びて
    //    「先端から動く」順番になる（実測で一番速く動く瞬間が 上腕 +0.050秒 に対し
    //    体幹 +0.033秒 と混ざっていた）。SHOT_RATE.shoulder(21) より速い 34/s。
    //    フレーム固定の 0.25 は 60fps 前提でしか合わないので dt から出す。
    this.shootLoad = expEase(this.shootLoad, this.shootLoadTarget, 34, this.lastDt);
    this.shootLoadTarget = 0;
    // 突く腕の保持を切らす（digReach が呼ばれなくなったら次の突きで決め直す）。
    if (this.punchHoldT > 0) this.punchHoldT = Math.max(0, this.punchHoldT - this.lastDt);
    if (this.leadHoldT > 0) this.leadHoldT = Math.max(0, this.leadHoldT - this.lastDt);
    this.jumpLoad = expEase(this.jumpLoad, this.jumpLoadTarget, 34, this.lastDt);
    this.digLoad = expEase(this.digLoad, this.digLoadTarget, 26, this.lastDt);
    this.digLoadTarget = 0;   // digReach が毎フレーム入れ直す
    if (this.shootLoad > 0.003 || this.jumpLoad > 0.003 || this.digLoad > 0.003) {
      this.applyShootLoad();
    }
    // 床のボールをすくい上げる進捗（target は liveball の pickup が毎フレーム設定）。
    // 姿勢そのものは objcts の "pickup" クリップ（voxel-motion）が持つ。
    this.scoopLoad += (this.scoopLoadTarget - this.scoopLoad) * 0.25;
    this.scoopLoadTarget = 0;
    // ⚠️ 溜め・落胆は胴を腰でヒンジさせるオフセット(torsoNode.position / rotation.x)を書く。
    //    どちらも当たらなくなったフレームで戻さないと、上半身が腰からずれたまま残る。
    if (!this.hingePosed) {
      this.torsoNode.rotation.x = 0;
      this.torsoNode.position.set(0, 0, 0);
      this.headPitch = 0;
    }
    this.hingePosed = false;
    this.syncVoxel();   // 仮想の関節ノード → ボクセルの標準ボーン
};

  // 浮遊ネームタグとその下のスタミナゲージを描画する。背番号は名前の横ではなく
  // 選手の背中（デカール）にある。
  // ゲージはタンクの残り(1 - fatigue)を示す: 元気なら緑、息が上がると
  // アンバー、バテると赤。
Player.prototype.drawNameTag = function(): void {
    const ctx = this.nameTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 64);
    // 背景ボックスなし — ドロップシャドウがコート上でテキストを読みやすく保つ
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "#fff";   // 白がコート上で最も読みやすい（チーム=ユニフォーム色）
    // 長いデータベース名（例: クリスティアーノ・ロナウド）はタグに収まるよう縮小する
    const size = this.name.length > 11 ? 18 : this.name.length > 7 ? 24 : 30;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.name, 128, 24);

    // スタミナゲージ（トラック+フィル） — HUDがネームタグに表示する設定のときのみ。
    // "icon"モードでは代わりに下部HUDの顔アイコンの下に置かれる
    if (HUD_OPTS.staminaOn === "name") {
      const left = 14, top = 46, width = 228, height = 10;
      const frac = clamp(1 - this.fatigue, 0, 1);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(left, top, width, height);
      ctx.fillStyle = frac > 0.5 ? "rgb(80,220,110)"
        : frac > 0.25 ? "rgb(240,200,70)" : "rgb(235,80,60)";
      ctx.fillRect(left, top, width * frac, height);
    }
    ctx.shadowBlur = 0;

    this.nameTex.update();
    // 表示するかどうかは updateNameTags(core/visuals) が毎フレーム決める
    this.gaugeDrawn = this.fatigue;
    this.gaugeRev = HUD_OPTS.rev;
};

  /** チームの現在アクティブなユニフォーム（ホーム/アウェイ）からこの選手のキットを
   *  再着色する。TEAM_UNIFORM変更後に呼ばれ、スワップがライブに表示される。
   *  ⚠️ ボクセルはキット色を頂点色に焼くのでメッシュを作り直す（着替えは試合前だけ）。 */
Player.prototype.applyUniform = function(): void {
    const u = this.kitOverride ?? uniformOf(this.team);
    this.vox?.setKit({ top: u.top, bottom: u.bottom, shoes: u.shoes });
};

  /** この選手にネームタグを出してよいかどうか（イントロツアー中や審判・プレビュー用の
   *  選手は常に非表示）。許可した後の実際の表示可否は updateNameTags が HUD 設定から決める。 */
Player.prototype.setNameTagVisible = function(v: boolean): void {
    this.nameTagAllowed = v;
    // 隠すのは即座に（ツアー中は syncAll が走らない）。出す側は updateNameTags に任せる
    // ＝ツアー明けに全員の名前が一瞬出てしまうのを防ぐ。
    if (!v) this.namePlane.isVisible = false;
};

