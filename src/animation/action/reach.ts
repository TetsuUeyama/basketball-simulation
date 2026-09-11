// リーチ/ディグ（ルーズボール・こぼれ球へ手を伸ばす）アクションのアニメ。
// basic/arms・basic/torso のムーバ経由で動く。
import { Vector3, Quaternion } from "@babylonjs/core";
import { clamp, normAngle } from "../../util";
import { JOINT, MOVE_RATE } from "../basic/joints";
import { Player } from "../../objects/player/player";

declare module "../../objects/player/player" {
  interface Player {
    reach(world: Vector3, both?: boolean): void;
    digReach(world: Vector3): void;
  }
}

/** 右手（または両手）を伸ばして手のひらが `world` — ボール — に合うようにする。
 *  ⚠️ 届く距離ならIKで手先を `world` に**乗せる**（方向付けだけだと手が腕の長さぶん
 *  先へ行き、ボールが前腕に来る）。届かない目標（ベンチの歓声で頭上3mへ手を上げる等）は
 *  FKで方向だけ向ける。速度は素早いリーチ（MOVE_RATE.reach）。 */
Player.prototype.reach = function(world: Vector3, both = false): void {
    this.reachBall(world, both);
};

// 使い回しの一時オブジェクト（毎フレーム new しない）。
const _aim = new Vector3();
const _xAxis = new Vector3(1, 0, 0);

// 突き(パンチ)の各段の形。⚠️ 溜め→突きの順で体幹→肩→肘と伝える。肘を先に伸ばすと
//    「腕を振っている」だけに見える（ユーザー指摘の棒立ち感の正体）。
// 突く側の肩を前に出すための胴の回転(rad)。⚠️ 的へ向けるツイスト(tw)は守備者が
// 既に正対しているぶん小さい(実測 0.475rad)。パンチに見せるには tw を**追い越して**
// 肩を前に出す必要がある。符号はモデルのリグ依存なので probe-steal で実測して決めた。
// ⚠️ 確認ページ(confirm.ts)がこのオブジェクトを直接いじって調整する。**同じ値を**
//    試合でも使うので、確認ページで見えたものがそのまま試合に出る。定数に戻さないこと。
export const PUNCH = {
  twist: 0.50,        // 突きで的へのツイストを追い越す量(rad)
  cockShoulder: 0.30, // 溜めで突く側の肩を引く量(rad)
  cockElbow: 1.20,    // 溜めで畳む肘(rad)。突きで 0 へ伸ばす
  cockLean: 0.05,     // 溜めで少し引く(rad)
  lungeLean: 0.16,    // 突きで踏み込む前傾(rad ≈ 9°)
  cockFrac: 0.42,     // 溜め(引き)に使う割合。残りで突く。1.0 で当たる瞬間に伸び切る
  // 逆手（歩く腕振りと同じ、肘を曲げたフォーム）。⚠️ **マイナスが後ろ**。
  // 実測(probe-backarm、numberSide 両方で同値): 肘1.0rad のとき
  //   -0.8→手首 -0.12m(後ろ) / -0.4→+0.05 / 0.0→+0.22(前)。前に出さないので負の側を使う。
  backCock: -0.55,    // 逆手: 溜めの振り(rad)
  backThrust: -1.00,  // 逆手: 突きの振り(rad)。突くほど後ろへ引く
  backBend: 1.00,     // 逆手の肘の曲げ(rad ≈ 57°)。歩く時と同じ曲げたフォーム
  cockIn: 0.06,       // 引いた手を体からどれだけ前に置くか(m)
  cockRise: 0.00,     // 引いた手の高さを的からどれだけ上げるか(m)。0 = 水平
  sink: 1.00,         // 沈み込みの強さ(倍)。0 で沈まない（腕だけで突く）
  sign: 1,           // 胴回転の符号。実測で決めた(下のコメント)
};
const WIND_FRAC = 0.30;    // アクション段階を持たない突きで、溜めに充てる割合
// 突く腕を保持する時間(秒)。digReach が毎フレーム呼ばれる間は保持され、
// 突きが終わって呼ばれなくなると切れて、次の突きで決め直す。
const PUNCH_HOLD = 0.10;
// 突きの胴回転の符号。⚠️ 推測禁止。probe-steal で「手のリーチが伸びる方」を実測して決める。
// 実測: sign -1 で手のリーチ 0.586m / +1 で 0.509m / 回転なし 0.399m
const smooth = (u: number): number => u * u * (3 - 2 * u);
const ramp = (u: number, a: number, b: number): number => smooth(clamp((u - a) / (b - a), 0, 1));

/** 突きの進捗。スティールは beginAction("steal", 溜め, 突き, 回復) の段階に合わせる
 *  ので、実際にボールへ当たるフレームと腕が伸び切るタイミングが揃う。 */
function punchPhase(p: Player): { wind: number; thrust: number } {
  if (p.actKind === "steal" && p.actPhase) {
    // ⚠️ 引きも突きも **windup の中**で終わらせる。windup が明けた瞬間(actFired)が
    //    ボールに当たるフレームなので、そこで腕が伸び切っていないといけない。
    //    以前は windup=引き / その後=突き にしていたため、当たる瞬間はまだ引いた形で、
    //    伸び切るのが 0.13 秒遅れていた（実測）。
    if (p.actPhase === "windup") {
      const d = p.actWindDur || 0.24;
      const u = clamp(1 - p.actT / d, 0, 1);
      const cf = PUNCH.cockFrac;
      return { wind: clamp(u / cf, 0, 1), thrust: clamp((u - cf) / Math.max(0.01, 1 - cf), 0, 1) };
    }
    return { wind: 1, thrust: 1 };   // 当ててからは伸ばし切ったまま保持し、回復で戻る
  }
  if (p.stealReachDur > 0) {   // 密集からのはたき: 段階を持たないので時間で割る
    const u = clamp(1 - p.stealReachT / p.stealReachDur, 0, 1);
    return { wind: clamp(u / WIND_FRAC, 0, 1),
      thrust: clamp((u - WIND_FRAC) / (1 - WIND_FRAC), 0, 1) };
  }
  return { wind: 1, thrust: 1 };   // ルーズボールの掻き出し: 溜め無しでそのまま伸ばす
}

/** ディグ(掻き出し)／スティールの突き: 小さく引いてから、上半身を回しながら片手を
 *  前へ突き出す。体幹→肩→肘の順に伝わるのでリーチが伸びる。反対の腕は逆へ振れて
 *  カウンターウェイトになる。守備者がはたき出したルーズボールを突くのにも使う。 */
Player.prototype.digReach = function(world: Vector3): void {
    const ph = punchPhase(this);
    // 突く腕を決める（突きの間は保持）。⚠️ 判定に torsoTwist を混ぜてはいけない。
    //    この関数が入れたひねりが次フレームの判定を裏返し、左右がパタパタ入れ替わる。
    //    体の向き(root のヨー)だけで決める。
    if (this.punchHoldT <= 0) {
      const bth = this.root.rotation.y;
      const bx = world.x - this.root.position.x, bz = world.z - this.root.position.z;
      this.punchRight = Math.cos(bth) * bx - Math.sin(bth) * bz >= 0;
    }
    this.punchHoldT = PUNCH_HOLD;
    // 腕は素早いリーチの速さで動かす。⚠️ 既定(MOVE_RATE.arm=10/s)だと時定数 0.1秒で、
    //    0.12秒の溜めの間に 7 割しか動けず、突きが間延びする。
    this.armRateCap = MOVE_RATE.reach;
    const w = smooth(ph.wind);
    const th = smooth(ph.thrust);
    // 胴のツイスト: 溜めで的と逆へ、突きで振り抜いて的へ。先行する肩が前に出る。
    const fx = world.x - this.pos.x, fz = world.z - this.pos.z;
    if (Math.abs(fx) + Math.abs(fz) > 0.05) {
      const tw = clamp(normAngle(this.worldYawTo(world.x, world.z) - this.root.rotation.y),
        JOINT.chestTwist.min, JOINT.chestTwist.max);
      // 的へ向けたまま、突く側の肩を溜めで引き→突きで前へ出す。
      // ⚠️ **numberSide を掛ける**。胴のヨーは仮想リグのローカル（腕の前後が
      //    numberSide で入れ替わる）なので、掛けないと片側のコートでだけ
      //    「逆の肩が前に出る」。実測(probe-punch, 当たるフレームの肩の前後):
      //    掛けない場合 numberSide=+1 で -0.114m（逆側が前）/ -1 で +0.114m。
      //    掛ければ両方 +0.114m になる。的へ向けるツイスト(tw)はワールドのヨー差から
      //    出しているのでそのまま。
      const sg = (this.punchRight ? PUNCH.sign : -PUNCH.sign) * this.numberSide;
      const twist = clamp(tw + sg * (PUNCH.twist * th - PUNCH.cockShoulder * w * (1 - th)),
        JOINT.chestTwist.min, JOINT.chestTwist.max);
      this.torsoTwist = twist;
      this.torsoNode.rotation.y = twist;
    }
    // ⚠️ 腕の選択は上の高さ計算より前に要る（肩の位置を使うため）。
    const right = this.punchRight;
    const lead = right ? this.armPivotR : this.armPivotL;
    const leadElbow = right ? this.elbowR : this.elbowL;
    const back = right ? this.armPivotL : this.armPivotR;
    const backElbow = right ? this.elbowL : this.elbowR;
    // 踏み込み: 溜めで少し引き、突きで的へ前傾する（sync が見た目の傾きに足す）。
    {
      const hl = Math.hypot(fx, fz) || 1;
      const k = PUNCH.lungeLean * th - PUNCH.cockLean * w * (1 - th);
      this.digLeanX = (fx / hl) * k;
      this.digLeanZ = (fz / hl) * k;
    }
    // 肩が先、肘は遅れて伸び切る（体幹→肩→肘）。溜め中は手を胸元へ引いておく。
    const rS = ramp(th, 0, 0.85);
    const rE = ramp(th, 0.30, 1.0);
    // ⚠️ 引いた位置の高さは「**手が最後に届く高さ**」に合わせる。ここを外すと軌道が
    //    斜めになる。的が腕の届く範囲なら的の高さ、届かないなら腕を伸ばし切った時の
    //    高さ。届かない的に FK で伸ばすと手が肩の高さ寄りに残るので、引き手を的の
    //    高さに置くと途中で跳ね上がって「上から振り下ろす」ように見えていた
    //    （実測: 的 0.95m に対し手首が 1.07→1.25m と上がっていた）。
    const th2 = this.root.rotation.y + this.torsoTwist;
    const cc = Math.cos(th2), ss = Math.sin(th2);
    const lpx = lead.position.x, lpy = lead.position.y * this.root.scaling.y, lpz = lead.position.z;
    const sx = this.root.position.x + (cc * lpx + ss * lpz);
    const sy = this.root.position.y + lpy;
    const sz = this.root.position.z + (-ss * lpx + cc * lpz);
    const armLen = (Player.UPPER_ARM + Player.FOREARM) * this.root.scaling.y;
    const sd = Math.hypot(world.x - sx, world.y - sy, world.z - sz) || 1;
    const endY = sd > armLen ? sy + (world.y - sy) / sd * armLen : world.y;
    // 沈み込み: 肩が的よりどれだけ高いかで深さを決める。突くほど深く沈む。
    // ⚠️ これが無いと、肩が的より高いぶん手は伸ばすほど上がり、水平にならない。
    this.digLoadTarget = clamp((sy - world.y - 0.15) / 0.40, 0, 1) * PUNCH.sink
      * Math.max(0.35, Math.max(w * 0.6, th));
    const cn = Math.hypot(fx, fz) || 1;
    const cx = this.pos.x + (fx / cn) * PUNCH.cockIn;
    const cz = this.pos.z + (fz / cn) * PUNCH.cockIn;
    const cy = endY + PUNCH.cockRise;
    // 高さは endY で固定し、水平方向だけ的へ伸ばす = 水平移動。
    _aim.set(cx + (world.x - cx) * rS, cy + (endY - cy) * rS, cz + (world.z - cz) * rS);
    // ⚠️ 届く的は IK で手先を**その点に乗せる**。方向だけ向ける(FK)と手が的の高さまで
    //    下りず、実測で的 0.95m に対して手首が 1.12〜1.26m にとどまり、
    //    「上から振り下ろす」ように見えていた。届かない的だけ FK で伸ばし切る。
    if (!this.reachIK(lead, leadElbow, _aim)) {
      this.aimArm(lead, _aim);
      this.bendElbow(leadElbow, clamp(w - rE, 0, 1) * PUNCH.cockElbow);
    }
    // 反対の腕: ⚠️ **前に出さない**。パンチの逆手はガードのまま後ろへ引ける。
    //    実測で溜め中に前へ 0.13m 出ていた（0.12rad が体より前だった）。
    // ⚠️ 振りの符号は locomotion と同じ規約（* numberSide）。生の値だと体の向きで
    //    前後が裏返る。曲げ量は歩く時と同じ帯（carry ≈ 0.6〜1.1）に合わせる。
    const bs = (PUNCH.backCock + (PUNCH.backThrust - PUNCH.backCock) * th) * this.numberSide;
    this.easeArm(back, Quaternion.RotationAxis(_xAxis, bs));
    this.bendElbow(backElbow, PUNCH.backBend);
    this.armRateCap = 0;   // 既定へ戻す（他のIK利用へ持ち越さない）
};
