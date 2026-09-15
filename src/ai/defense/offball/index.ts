// オフボール守備: ボールを持たない相手に付く1人ぶんの1フレーム。カバーリング(ドライブの
// ヘルプ)、リムアンカー(常時ペイント)、通路ブロック、ゲットバック、そして DENY / ヘルプサグ。
import { Vector3 } from "@babylonjs/core";
import { Player } from "../../../objects/player/player";
import { rate, clamp, chance, dist2D, dist2DTo, moveToward2D, towardPoint } from "../../../util";
import { twWeight, leapHeight } from "../../../eval";
import { defEffort, denyIntensity, getBackOnDefense } from "../shared";
import { attnTo } from "../../attention";
import { THREE_DIST } from "../../../config";
import { TACTICS } from "../../../attributes";
import type { Game } from "../../../game";

// anchor は今このポゼッションでリムに残す1人（runDefense が毎tick選ぶ）。
/**
 * 守備フォーメーション（シェル）の持ち場。守備の第一優先は**陣形を整えること**で、
 * マンマークは相手がこの陣形の中へ入ってきてから始める。
 * ⚠️ 実測（4試合）: 担当がリムから 9m より外に居るのに 19% の頻度で 2m 以内まで付いて
 *    いた一方、アーク内(4.5〜6.75m)に入ってきた担当に 2m 以内で付けていたのは 47%
 *    しかなかった。守らなくていい所で付き、守るべき所で付いていない状態だった。
 * 配置は攻撃のフォーメーションと同じ形を、リム寄りへ引き込んだもの。
 * slot: 0=ポイント 1/2=ウイング 3/4=ベースライン寄り。
 */
export const DEF_BASE_DEFAULT: { x: number; d: number }[] = [
  { x: 0.0, d: 5.2 },    // 0 トップ
  { x: -4.2, d: 3.2 },   // 1 左ウイング
  { x: 4.2, d: 3.2 },    // 2 右ウイング
  { x: -3.6, d: 1.0 },   // 3 左ベースライン
  { x: 3.6, d: 1.0 },    // 4 右ベースライン
];
/** 守備フォーメーション内と見なす半径。ここへ相手が入ってきたらマンマークへ切り替える。 */
const SHELL_IN = THREE_DIST + 0.6;
/** 本物の3Pシューターだけは、これだけ外まで捕まえに出る。 */
const SHELL_SHOOTER = THREE_DIST + 1.6;

function shellSpot(game: Game, d: Player, protect: Vector3, defTeam: number): [number, number] {
  const dir = game.attackSign(defTeam);   // 守るリムからミッドコートへ向かう向き
  // ⚠️ チームごとの守備ベース位置（フォーメーションボードで編集）。無ければ既定値。
  const base = TACTICS[defTeam].defBase ?? DEF_BASE_DEFAULT;
  const b = base[d.slot] ?? base[0] ?? DEF_BASE_DEFAULT[0];
  return [protect.x + b.x, protect.z + dir * b.d];
}

export function defendOffBall(
  game: Game, dt: number, d: Player, man: Player, protect: Vector3,
  defTeam: number, anchor: Player | null,
): void {
  // カバーリング: ボール守備が抜かれたら、カバー守備者が担当を捨ててドライブレーンへ
  if (game.handler && game.handler.beatenT > 0 && d.has("covering")) {
    const hx = game.handler.pos.x, hz = game.handler.pos.z;
    const t = 0.55;   // レーンの途中で迎える
    const ctx = hx + (protect.x - hx) * t, ctz = hz + (protect.z - hz) * t;
    moveToward2D(d.pos, ctx, ctz,
      d.accelToward(dt, ctx, ctz, 1.12 * Math.max(defEffort(game, d, protect), 0.9)) * dt);
    game.clampCourt(d.pos);
    return;
  }

/** リムアンカーが自分から飛び込む起こりやすさ。 */
const ANCHOR_RATE = 0.75;

  // リムアンカー: 常時ペイントに残る壁役。ハンドラーがリムへ迫れば飛んでコンテスト、
  // 遠ければゴール下(リムと担当の間・リム寄り)に常駐してゴール下を空けない。
  if (d === anchor && game.handler) {
    const hx = game.handler.pos.x, hz = game.handler.pos.z;
    const dRim = dist2DTo(game.handler.pos, protect.x, protect.z);
    // リムプロテクターは飛ぶタイミングを計る
    if (!d.airborne && d.landT <= 0 && dRim < 4.5
        && dist2D(d.pos, game.handler.pos) < 2.6) {
      // ⚠️ 頻度を 1/4 にした。シュートが始まっていないのに跳ぶので、外すと
      //    着地硬直のあいだゴール下が空く。実際のシュートには shooting.ts 側が
      //    必ず跳ぶようになっているので、こちらは待つ方が守れる。
      const timing = rate(d.attr.reaction) * 0.5 + rate(d.attr.defense) * 0.3;
      if (chance((0.35 + timing * 0.9) * dt * ANCHOR_RATE)) {
        game.contestLeap(d, game.handler.pos, leapHeight(d), 0.6);
      }
    }
    if (dRim < 8) {
      const rt = towardPoint(protect.x, protect.z, hx, hz, 2.0);
      const rtx = rt.x, rtz = rt.z;
      moveToward2D(d.pos, rtx, rtz,
        d.accelToward(dt, rtx, rtz, 1.1 * Math.max(defEffort(game, d, protect), 0.9)) * dt);
      game.clampCourt(d.pos);
      return;
    }
    // ハンドラーが遠い(ハーフコート)時も、ローマンはペイント内に常駐して壁を作る:
    // リムと自分のマークの間の、リム寄りの点(≈2.6m)。ゴール下がスカスカにならない。
    {
      const hp = towardPoint(protect.x, protect.z, man.pos.x, man.pos.z, 2.6);
      moveToward2D(d.pos, hp.x, hp.z,
        d.accelToward(dt, hp.x, hp.z, 0.95 * Math.max(defEffort(game, d, protect), 0.8)) * dt);
      game.clampCourt(d.pos);
      return;
    }
  }

  // 通路ブロック: 相手が横に回り込んだら、新しいレーンの入口へスライドして応じる
  if (d.wallT > 0) {
    moveToward2D(d.pos, d.wallX, d.wallZ,
      d.accelToward(dt, d.wallX, d.wallZ, 1.05 * Math.max(defEffort(game, d, protect), 0.85)) * dt);
    game.clampCourt(d.pos);
    return;
  }

  // トランジション: ポゼッション交代で上に残っていたら、まず戻る
  if (getBackOnDefense(game, dt, d, man)) return;

  // 見えているマークの位置（ai/attention.ts が毎フレーム更新）。実位置ではなくこれを守る。
  const seenX = d.trackX, seenZ = d.trackZ;
  // オフボール: ストロングサイド(ボール側)の1パスアウェイのみパスコースを DENY し、
  // ウィークサイド/遠い担当はゴール方向へ深くサグしてヘルプ(ボールを追って外に出ない)。
  // ハンドラーがライブドライブ中(抜き去り/パワー)は deny を止め、全員ヘルプサグでリムへ潰れる。
  const help = game.tactics[defTeam].defense.help * twWeight(d);
  const driveLive = !!game.handler && (game.handler.beatenT > 0 || game.handler.powerT > 0);
  const ballGap = game.handler ? dist2D(man.pos, game.handler.pos) : 99;
  // ボール側判定: 担当がボールと同じ左右(リム基準)か、ボールが中央付近ならストロングサイド扱い。
  let ballSide = true;
  if (game.handler) {
    const bx = game.handler.pos.x - protect.x, mx = man.pos.x - protect.x;
    ballSide = Math.abs(bx) < 1.5 || mx * bx >= 0;
  }
  // パック・ザ・ペイント: ペイント/得点圏(リムから4.5m内)の脅威か本物の3Pシューターの時だけ付く。
  // 周辺(アーク付近含む)の非シューターは脅威でないので付かず deny もせず、3Pラインの内側へ深く
  // サグしてゾーン/リムを守る(釣り出されない)。
  const mRim = dist2DTo(protect, seenX, seenZ);
  const shooter3 = rate(man.attr.threeAcc) >= 0.82;   // 上位1割の3Pシューターのみ外まで付く
  // ⚠️ 以前は 4.5m。3Pラインが 6.75m なので、アークの内側に立っている相手に**誰も付かない**
  //    状態だった（実測: マンがリムから 4.8〜7.35m に居るとき、守備との距離は中央 2.87m・
  //    47% が 3m 超）。3Pラインの内側へ入ってきた相手は必ず捕まえる。
  // 守備の優先順位: ①まず陣形を整える ②相手が陣形へ入ってきたらマンマークする。
  // ⚠️ ゾーン指定の選手は担当を追わない。常に守備ベース（シェル）を保つ。
  const pickup = d.defMode === "zone" ? false
    : mRim < SHELL_IN || (shooter3 && mRim < SHELL_SHOOTER);
  if (!pickup) {
    // 担当はまだ遠い — 追いかけず、自分の持ち場（シェル）を埋める。
    const [fx, fz] = shellSpot(game, d, protect, defTeam);
    moveToward2D(d.pos, fx, fz,
      d.accelToward(dt, fx, fz, Math.max(defEffort(game, d, protect), 1.0)) * dt);
    game.clampCourt(d.pos);
    return;
  }
  let stx: number, stz: number;
  let denying = false;
  if (game.handler && !driveLive && ballSide && ballGap < 6.5 && ballGap > 0.8 && !man.airborne && pickup) {
    denying = true;
    // DENY: マークとボールの間のパスコースへ割って入り消す。ボール→マーク線上の、マークから
    // ボール側へ laneStep 出た点（レーンに体を入れる）。密着度＝守備+敏捷（振り切られない能力）。
    const lock = rate(d.attr.defense) * 0.55 + rate(d.attr.agility) * 0.45;
    // レーンへ割り込む距離: 良い守備ほど深くボール寄りでレーンを潰す（振り切られ中は浅くなる）。
    // マークが速く動く間はマーク近くでレーンに留まり(横ずれを抑える)、静止時は深く割り込む。
    const mv = Math.hypot(man.velX, man.velZ);
    // タイト寄り(マーク近く)にしてボール回転への追従遅れを抑える＝レーン上に留まる。
    const laneStep = clamp((0.55 + lock * 0.5 - man.shakeOpenT * 1.2) * (mv > 3 ? 0.7 : 1), 0.35, 1.1);
    const dn = towardPoint(seenX, seenZ, game.handler.pos.x, game.handler.pos.z, laneStep);
    stx = dn.x; stz = dn.z;
    // レーンを塞いでいる印。注目システム（ボールを見る＝バックドアに弱い）と、
    // 攻撃側の「潰されている」判定に使う。
    d.denyT = 0.25;
  } else {
    // ヘルプサグ: ウィークサイド/遠いほど深くリムへ寄る。クロック終盤の DENY 強化も反映。
    const weak = !ballSide || ballGap > 6.5;
    let sag = (1.2 + help * 1.4 + (weak ? 1.2 : 0)) * (game.teamHas(defTeam, "dfLine") ? 1.15 : 1)
      * (1 - denyIntensity(game, defTeam) * 0.8);
    // ⚠️ 3Pラインの内側へ入ってきた相手は**マンマーク**する。ここを緩めると、アークの
    //    内側に立っているのに誰も付いていない絵になる（実測: 守備との距離 中央 2.84m・
    //    45% が 3m 超）。ウィークサイドのヘルプだけは例外（付いて行くとリムが空く）。
    // ⚠️ 境目は**攻撃が実際に立つ位置**まで広げること。スポットはリムから 6.95〜7.0m に
    //    あるので、THREE_DIST+0.2(=6.95m) だと立ち位置がちょうど枠の外に落ち、
    //    そこだけマークが緩む（実測: 6.4〜6.95m 帯は中央 2.35m なのに、
    //    6.95〜7.5m 帯は 2.86m・46%が3m超と段差ができていた）。
    // ⚠️ ボール側は**体が当たる間合い**まで詰める。1.05m では一度も触れず、
    //    「マークの攻防」が画面に出ない（実測: 体が当たっている割合 0.2%、1.2m 未満 23.4%）。
    if (mRim < THREE_DIST + 1.2) sag = Math.min(sag, ballSide ? 0.72 : 1.6);
    const st = towardPoint(seenX, seenZ, protect.x, protect.z, sag);
    stx = st.x; stz = st.z;
    // ⚠️ 旧「非脅威は半径5mまで」のクランプは削除。陣形へ入っていない担当は上で
    //    シェルへ返しているので、ここへは来ない。
  }
  // 進路 denial: 動いている男の行き先を影で追う(先読みは上限付き)。振り切り優位で読みが鈍る。
  // deny 中は先読みを弱めてボール→マークのレーン上に体を残す（レーンを塞ぐのが見えるように）。
  const mSpd = Math.hypot(man.velX, man.velZ);
  if (mSpd > 2.5) {
    const read = (0.15 + rate(d.attr.reaction) * 0.22 + rate(d.attr.defense) * 0.10)
      * (1 - man.shakeOpenT * 0.6) * (denying ? 0.4 : 1);
    const cap = Math.min(1, 2.0 / (mSpd * read || 1));   // 先読みは最大~2m
    stx += man.velX * read * cap;
    stz += man.velZ * read * cap;
  }
  // deny 中はレーンへ素早く寄せる（追従の横ずれを抑え、パスコースを塞ぐのが見えるように）。
  let eff = denying ? Math.max(defEffort(game, d, protect), 1.25) : defEffort(game, d, protect);
  // ⚠️ 振り切られた直後は追走が一拍遅れる。ここを等速のままにすると、
  //    攻撃が「外した」あとも守備が同じ速さで付いて来て、外しが無かったことになる。
  if (man.shakeOpenT > 0) eff *= 1 - Math.min(0.55, man.shakeOpenT * 0.45);
  moveToward2D(d.pos, stx, stz, d.accelToward(dt, stx, stz, eff) * dt);
  game.clampCourt(d.pos);
}
