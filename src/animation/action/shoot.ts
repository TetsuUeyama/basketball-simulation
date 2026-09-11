// 利き手で放つシュートフォーム。利き手=シュートハンド（伸ばして放つ・フォロースルー）、
// 逆手=添え手（ガイド）。全シュート種別（ダンク/レイアップ/ミドル/3P/FT）共通。
// basic/arms のムーバ経由、速度は MOVE_RATE.reach。
import { Vector3 } from "@babylonjs/core";
import { MOVE_RATE } from "../basic/joints";
import { clamp } from "../../util";
import { Player } from "../../objects/player/player";

/**
 * シュートで関節を動かす速さ(1/s)。体幹に近いほど速く＝先に着き、先端ほど遅れる。
 *
 * ⚠️ 以前は肩も肘も一律 MOVE_RATE.reach(30) で、実測すると上腕の角速度が
 *    1800°/s ちょうど＝**全体のレート上限に張り付いて**いた（瞬間移動と同じ）。
 *    しかも一番速く動く瞬間が 上腕 +0.050秒 / 前腕 +0.033秒 と、先端の方が先に
 *    動いていて順番が逆だった。
 */
const SHOT_RATE = { shoulder: 21, elbow: 12 };
/** 休めの肘の曲げ。フォロースルーの終わりをここへ合わせて、切り替えで飛ばさない。 */
const REST_ELBOW = 0.28;
/** なめらかな 0→1（両端で速度 0）。フォロースルーの緩め方に使う。 */
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** a..b の区間だけ 0→1 になるランプ。関節ごとに始まりをずらして順番を作る。 */
const ramp = (u: number, a: number, b: number): number => smooth(clamp((u - a) / (b - a), 0, 1));

// 3P の溜めでボールを構える高さの上げ幅(m)。上腕が少し上がり肘が深く畳まれる。
const DEEP_LIFT = 0.16;

// 溜めの姿勢の角度(rad, shootLoad=1 のとき)。lean=上半身の前傾、thigh=腿を前へ倒す角、
// shin=脛を後ろへ折り返す角。thigh を深く・lean を浅くするほど腰で「く」の字になる。
const POSE = { lean: 0.30, thigh: 0.55, shin: 0.33 };
// 踏み切り前の沈み込み: ほぼ垂直に沈む(前傾は浅い)。上へ跳ぶための溜め。
const POSE_JUMP = { lean: 0.12, thigh: 0.46, shin: 0.30 };
// 突き/掻き出しの沈み込み: 膝を折って腰を落とす。上体は起こしたまま（前のめりにしない）。
const POSE_DIG = { lean: 0.10, thigh: 0.62, shin: 0.42 };
// 3P: 下半身を前斜めへ深く倒し、上半身はほぼ起こす。
const POSE_3P = { lean: 0.08, thigh: 0.70, shin: 0.30 };

declare module "../../objects/player/player" {
  interface Player {
    shootArms(world: Vector3, guide: boolean): void;
    gatherHold(world: Vector3, deep?: boolean): void;
    applyShootLoad(): void;
  }
}

/** ギャザーの構え: おなかの前で両手にボールを抱える（両肘を程よく曲げる）。
 *  holdBallHands が両手をボールの両側に添える。リリースで shootArms が利き手の
 *  シュートフォームへ引き継ぐ。charge 中に毎フレーム呼ぶ。 */
Player.prototype.gatherHold = function(world: Vector3, deep = false): void {
    this.armRateCap = MOVE_RATE.reach;
    this.followDur = 0;   // 溜め直し = 次のフォロースルーは全長を取り直す
    // ⚠️ 肘を胴に寄せる。既定の張り出し 0.70(≒35°) はボールへ手を伸ばす用で、
    //    胸の前で構えると肘が横へ大きく開いてしまう。
    this.elbowOut = deep ? 0.14 : 0.20;
    // 3P の溜め: 上腕を少し上げ、肘を深く畳んでボールを高い位置で構える。
    // 保持点を上げると IK が肩を上げ肘を畳むので、腕の形はここで決まる。
    const w = deep ? new Vector3(world.x, world.y + DEEP_LIFT, world.z) : world;
    this.holdBallHands(w, deep ? 0.10 : 0.13);   // 両手をボールの両側へ（deep は手幅も狭く）
    this.elbowOut = 0.70;                        // 既定へ戻す（他のIK利用へ持ち越さない）
    this.armRateCap = 0;
};

/** シュートの溜めの姿勢: 前傾（腰ヒンジ）＋沈み込み（体を下げ足を縮める）を
 *  shootLoad(0..1) の深さで適用する。3P(gatherDeep) は下半身を前斜めに深く倒し、
 *  上半身を起こして腰で「く」の字を作る。リリースで shootLoad が0へ戻ると自動で
 *  直立に伸び上がる。sync() から毎フレーム呼ぶ。 */
Player.prototype.applyShootLoad = function(): void {
    // シュートの溜め・踏み切り・突きの沈み込みは同じ屈み。深い方を採る。
    const L = Math.max(this.shootLoad, Math.max(this.jumpLoad, this.digLoad));
    const F = this.digLoad >= L ? POSE_DIG
      : this.jumpLoad > this.shootLoad ? POSE_JUMP
        : this.gatherDeep ? POSE_3P : POSE;
    this.hingePosed = true;   // 胴の腰ヒンジを当てた（sync が戻さないように）
    // 前傾: 胸を腰の切れ目でヒンジさせて前へ倒す（脚・腰は垂直のまま）。dejected と同規約。
    const Pt = -this.numberSide * F.lean * L;
    const cut = Player.WAIST_HINGE;
    this.torsoNode.rotation.x = Pt;                   // 上半身: 前傾
    this.torsoNode.position.set(0, cut * (1 - Math.cos(Pt)), -cut * Math.sin(Pt));
    // 前傾しても顔はゴール方向（水平）へ。頭のピッチで胴の前傾を打ち消す。
    this.headPitch = -Pt;
    // 下半身: 腿を前へ倒し(a)、脛を後ろへ折り返す(b)。腰は root の真上に残るので、
    // 倒すほど膝と足が前へ出て腰との折れ目が深くなる。
    const a = F.thigh * L;                            // 腿のワールド前傾角
    const b = -F.shin * L;                            // 脛のワールド角（負＝後ろへ）
    const ns = this.numberSide;
    this.hipL.rotation.x = this.hipR.rotation.x = a * ns;
    this.kneeL.rotation.x = this.kneeR.rotation.x = (b - a) * ns;
    // root は床のアンカーなので、脚が縮んだぶんだけ下げないと足が床から浮く。
    const leg = (this.vox ? this.vox.hipY : Player.HIP_Y) / 2;   // 腿 ≒ 脛
    this.root.position.y -= 2 * leg - leg * (Math.cos(a) + Math.cos(b));
};

/** 利き手を `world`（ボール→リム）へ伸ばして放つ。guide=true はギャザー/リリース中で
 *  逆手をボール脇に添える、false はフォロースルーで逆手を下げる。 */
Player.prototype.shootArms = function(world: Vector3, guide: boolean): void {
    // 利き手ノードは numberSide を織り込む: setNumberSide は腕/目のZ(前後)のみ反転しX
    // (左右)は不変。+X は numberSide=+1 の時だけ体の右(armR)、-1 では体の左になる。よって
    // 右利き(hand="R")の実際の右手は numberSide>0 で armR、<0 で armL。
    const R = (this.hand === "R") === (this.numberSide > 0);
    const domP = R ? this.armPivotR : this.armPivotL;   // 利き手（シュートハンド）
    const domE = R ? this.elbowR : this.elbowL;
    const offP = R ? this.armPivotL : this.armPivotR;   // 逆手（添え手）
    const offE = R ? this.elbowL : this.elbowR;
    const offside = R ? -1 : 1;                          // 添え手の外側
    // 肩のワールド位置（aimArm / reachIK と同じ式。胴のツイストを織り込む）
    const th = this.root.rotation.y + this.torsoTwist;
    const c = Math.cos(th), sn = Math.sin(th);
    const px = domP.position.x, py = domP.position.y * this.root.scaling.y, pz = domP.position.z;
    const sx = this.root.position.x + (c * px + sn * pz);
    const sy = this.root.position.y + py;
    const sz = this.root.position.z + (-sn * px + c * pz);

    // ボールが腕の届く範囲を出たか。⚠️ 出た後も追い続けると腕が飛んでいくボールを
    // 追いかけ、実測で上腕が 1800°/s（全体のレート上限）に張り付いていた。
    const arm = (this.vox ? this.vox.upperArm + this.vox.foreArm : 0.55) * this.root.scaling.y;
    const far = guide
      && Math.hypot(world.x - sx, world.y - sy, world.z - sz) > arm + 0.20;
    if (guide && !far) {
      this.followDur = 0;   // 次のフォロースルーで全長を取り直す
      // guide 中の `world` はボールそのもの。⚠️ 手のひらをIKでボールの面に乗せる
      // （FKで方向付けするだけだと手が腕の長さぶん通り越し、ボールが前腕に来る）。
      // 掴む位置は片手シュートの形: 利き手はボールの後ろ（体側）・やや下、添え手は横。
      this.armRateCap = MOVE_RATE.reach;
      const bx = this.pos.x - world.x, bz = this.pos.z - world.z;   // ボール→体（後ろ側）
      const bl = Math.hypot(bx, bz) || 1;
      const back = new Vector3(world.x + (bx / bl) * 0.10, world.y - 0.04, world.z + (bz / bl) * 0.10);
      // ローカル +X（体の右）のワールド方向。添え手はその外側へ
      const ox = Math.cos(th) * offside, oz = -Math.sin(th) * offside;
      const sideP = new Vector3(world.x + ox * 0.13, world.y, world.z + oz * 0.13);
      const okDom = this.reachIK(domP, domE, back);
      const okOff = this.reachIK(offP, offE, sideP);
      if (!okDom) {
        // FK の逃げ道。肩→肘の順に着くよう、肘だけ遅い速さで回す。
        this.aimArm(domP, world);
        this.armRateCap = SHOT_RATE.elbow;
        this.bendElbow(domE, 0.15);
        this.armRateCap = MOVE_RATE.reach;
      }
      if (!okOff) {
        // 添え手: ボールの脇に添えるガイド（深く曲げ、押し手にしない＝両手投げに見せない）
        this.aimArm(offP, world);
        this.armRateCap = SHOT_RATE.elbow;
        this.bendElbow(offE, 0.9);
      }
      this.armRateCap = 0;
      return;
    }

    // ── フォロースルー ──────────────────────────────────────────
    // ⚠️ 以前はリリースの形を coolT の間ずっと**固定**し、切れた瞬間に休めへ飛んで
    //    いた。実測で終わり際の角速度が上腕 75% で 88°/s（最大 1744°/s）残っていた。
    //    伸ばし切りから休めの形へ、体幹に近い順に緩めて 0 で着地させる。
    if (this.followDur <= 0) {
      this.followDur = Math.max(0.35, this.coolT);
      // ⚠️ 放った向きをここで1回だけ覚える。以後 world は見ない。呼び元は
      //    リリース中は「飛んでいくボール」、その後は「リム」を渡してくるので、
      //    毎フレーム狙い直すと切り替わりの瞬間に腕が跳ねる（実測 943〜1278°/s）。
      const dx0 = world.x - sx, dy0 = world.y - sy, dz0 = world.z - sz;
      const dl0 = Math.hypot(dx0, dy0, dz0) || 1;
      this.followAimX = (c * dx0 - sn * dz0) / dl0;   // ワールド → root ローカル
      this.followAimY = dy0 / dl0;
      this.followAimZ = (sn * dx0 + c * dz0) / dl0;
    }
    const u = clamp(1 - this.coolT / this.followDur, 0, 1);   // 0=リリース直後 .. 1=終わり
    const rS = ramp(u, 0.20, 0.95);   // 肩から緩みはじめ
    const rE = ramp(u, 0.35, 1.00);   // 肘はそのあと
    // 利き手: 放った向きへ伸ばし切り → 真下（＝休めの向き）へ寄せていく
    this.armRateCap = SHOT_RATE.shoulder;
    this.setArmDir(domP, this.followAimX * (1 - rS),
      this.followAimY * (1 - rS) - rS, this.followAimZ * (1 - rS));
    this.armRateCap = SHOT_RATE.elbow;
    this.bendElbow(domE, REST_ELBOW * rE);
    // 添え手: 横に広げず、下ろしていく
    this.armRateCap = SHOT_RATE.shoulder;
    this.setArmDir(offP, offside * 0.15 * (1 - rS), -0.95 - 0.05 * rS, 0.1 * (1 - rS));
    this.armRateCap = SHOT_RATE.elbow;
    this.bendElbow(offE, 0.6 + (REST_ELBOW - 0.6) * rE);
    this.armRateCap = 0;
};
