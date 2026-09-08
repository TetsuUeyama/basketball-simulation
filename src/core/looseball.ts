// ルーズボール物理。自由球の飛翔・反射、選手の追走、接触判定、確保(secureLoose)を集約。
import { Vector3 } from "@babylonjs/core";
import { Player } from "../objects/player/player";
import { COURT, SHOT_CLOCK, OOB_WALL } from "../config";
import { rate, clamp, chance, dist2DTo, moveToward2D, rand, nearestOf } from "../util";
import { looseSecureChance, twoHandedCatch } from "../move/reaction/rebound";
import { stepBallFlight } from "../move/basic/ball";
import { flashBall } from "./visuals";
import { twoHandGrab } from "./poses";
import type { Game } from "../game";

// 空中リバウンド確保をプットバックにするリムまでの距離(m)。ダンク/レイアップが打てる至近のみ。
// これを超える(距離が離れている)とプットバックせず、アウトレット/キック→着地して通常オフェンス。
const PUTBACK_RANGE = 2.0;
// ボールの重力(move/basic/ball.ts の BALL.gravity と同じ)。上げ直しの初速を解くのに使う。
const BALL_G = 9.0;

  // ボール自由飛翔の1フレーム（物理は move/basic/ball.ts のベースに委譲）。
  // ルーズボールと得点後の落下演出で共有する。生きたルーズボール(reflect = false)は
  // ラインを越えてアウトオブバウンズになれる（updateLoose が越えを検出）。
export function stepBallFreeFlight(game: Game, dt: number, reflect = true): void {
    stepBallFlight(game.ball, dt, reflect);
  }

export function updateLoose(game: Game, dt: number): void {
    if (game.blockHoldT > 0) {
      // ブロック接触: はたかれたボールは一拍止まってから、はじく速度が解放される
      game.blockHoldT -= dt;
      if (game.blockHoldT <= 0) game.ball.vel.copyFrom(game.blockHoldVel);
    } else {
      stepBallFreeFlight(game, dt, false);   // 生きたルーズボールはラインを越えることがある
      // アウトオブバウンズ: ラインを越えても壁(エプロン外)までは軌道のまま飛ばし、
      // 壁に達したら最後に触っていないチームのスローインにする。
      const b = game.ball.pos;
      if (Math.abs(b.x) > COURT.halfW + OOB_WALL || Math.abs(b.z) > COURT.halfL + OOB_WALL) {
        const to = game.lastTouch ? 1 - game.lastTouch.team : 1 - game.looseOff;
        game.inbound.startAt(to, b.x, b.z);
        return;
      }
    }
    for (const p of game.players) if (p.touchCool > 0) p.touchCool = Math.max(0, p.touchCool - dt);

    game.looseAge += dt;
    chaseLoose(game, dt);
    contestShove(game, dt);   // 競り合いの押し合い: バランスで弱い方を中心からずらす
    // 確保を一拍遅らせ、争奪として見えるようにする
    if (game.looseAge >= game.looseGrabAfter) resolveLooseContact(game);
    if (game.ballMode !== "loose") return;   // このフレームで誰かが確保した

    game.looseT -= dt;
    if (game.looseT <= 0) {                    // 安全網
      const b = game.ball.pos;
      if (Math.abs(b.x) > COURT.halfW || Math.abs(b.z) > COURT.halfL) {
        // ラインの外（エプロン内）で止まった → スローイン
        const to = game.lastTouch ? 1 - game.lastTouch.team : 1 - game.looseOff;
        game.inbound.startAt(to, b.x, b.z);
        return;
      }
      const near = nearestOf(game.players, (p) => dist2DTo(game.ball.pos, p.pos.x, p.pos.z))!;
      // 最寄りが遠い間はボールを手元へワープさせない: 追走を続けさせ(chaseLoose が最寄りを寄せる)、
      // 届いた選手が resolveLooseContact(0.6m)で確保する。長く誰も届かない時だけ最後の手段で確保。
      if (dist2DTo(game.ball.pos, near.pos.x, near.pos.z) > 1.2 && game.looseAge < 6) {
        game.looseT = 0.4;   // 安全網を延長して追走を継続(ワープ回避)
        return;
      }
      secureLoose(game, near);
    }
  }

  // ルーズボールを争うのは数人だけ、残りは次に備えて広がる。争う者は各チームの最も
  // 近い者＋本当に近い者、合計3人まで。
/**
 * 「いつ・どこで・どれだけ跳べばボールに手が届くか」を弾道から解く。
 *
 * ⚠️ 以前は「跳んだ頂点の高さまでボールが降りてくる時刻」だけを見ていた。リバウンドの
 *    ボールはリングから 3.05m 付近で出るので、その高さまで**上がってこない**ことが多く、
 *    解なし → ボールの今いる場所へ走る（＝昔のまま）に落ちていた。実測で、予測した
 *    落下点までの距離 3.40m に対しボールの今の位置まで 2.64m と、ボールを追っていた。
 *
 * ここでは「その時刻に走って行けて、かつその時のボールの高さが立ちリーチ＋ジャンプの
 * 範囲に入る」最も早い時刻を探す。返す h はその時刻に必要なジャンプの高さ。
 */
function planCatch(game: Game, p: Player): { x: number; z: number; t: number; h: number } | null {
  const y0 = game.ball.pos.y, vy = game.ball.vel.y;
  const stand = p.height * 1.35;                     // 立ったまま手が届く高さ
  const maxH = 0.55 + rate(p.attr.jump) * 0.45;      // 跳べる高さ
  // 到達判定は runDist（加速を織り込んだ距離）で行う。
  const STEP = 1 / 30;
  for (let t = STEP; t <= 2.5; t += STEP) {
    const by = y0 + vy * t - BALL_G * t * t / 2;
    if (by < FLOOR_Y) break;                          // 床に着く — 以後は弾道が変わる
    const x0 = game.ball.pos.x + game.ball.vel.x * t;
    const z0 = game.ball.pos.z + game.ball.vel.z * t;
    // ⚠️ **すでにその真下にいる**選手は別扱い。走って移動する必要がないので、
    //    上がってくる球でも、最大リーチぎりぎりでも跳んで competing する。
    //    これを分けないと、ゴール下で競っている選手の頭上をボールが通過しても
    //    「弾道が読めない／跳ぶ必要がない」と判定して跳ばなかった
    //    （実測: 6試合99場面のうち 68% でボールが最寄りの選手の手の上を通過）。
    const here = dist2DTo(p.pos, x0, z0) < CONTEST_NEAR;
    // 上昇中のボールに合わせてはいけない。リムから跳ね上がっている途中の高さで解くと
    // そこへ向けて踏み切ってしまい早すぎる。ただし真下にいる選手は例外。
    if (!here && vy - BALL_G * t > 0) continue;
    // 最大リーチぎりぎりは狙わない。手をボールの上に REACH_OVER だけ出せる高さまで。
    // （割合で削ると跳躍力の低い選手ほど余裕が足りなくなるので、絶対量で引く）
    if (by > stand + maxH - (here ? CONTEST_OVER : REACH_OVER)) continue;
    if (!here && dist2DTo(p.pos, x0, z0) > runDist(p, t) + 0.35) continue;   // 間に合わない
    return { x: x0, z: z0, t, h: Math.max(0, by - stand) };
  }
  return null;
}
/**
 * 今の速さから t 秒で進める距離(m)。
 * ⚠️ 以前は「いきなり最高速」で見積もっていた。実際には accelSpeed が加速度で立ち上がる
 *    ので、その見積もりだと到達時刻が早すぎ、その時刻の高さに合わせて踏み切っても体が
 *    そこまで届かない。結果、届く頃には plan.h が 0 になり「跳ばずに待つ」ばかりになる。
 */
function runDist(p: Player, t: number): number {
  const v = p.runSpeed * 1.35;
  const acc = 2.5 + Math.pow(rate(p.attr.accel), 2.2) * 15;
  const v0 = Math.min(p.curSpd, v);
  const tAcc = Math.max(0, (v - v0) / acc);
  if (t <= tAcc) return v0 * t + acc * t * t / 2;
  return v0 * tAcc + acc * tAcc * tAcc / 2 + v * (t - tAcc);
}
/** ボールが床に着く場所と時刻。手が届く時刻が無い選手はここへ向かう。 */
function landSpot(game: Game): { x: number; z: number; t: number } {
  const y0 = game.ball.pos.y, vy = game.ball.vel.y;
  // ⚠️ 判別式は vy² + 2G(y0 - h)。符号を逆にすると落下時刻がほぼ 0 になり、フォールバックが
  //    「ボールの今の位置へ全力」＝直したかったはずの昔の挙動に戻る。
  const disc = vy * vy + 2 * BALL_G * (y0 - FLOOR_Y);
  const t = disc >= 0 ? Math.max(0, (vy + Math.sqrt(disc)) / BALL_G) : 0;
  return { x: game.ball.pos.x + game.ball.vel.x * t, z: game.ball.pos.z + game.ball.vel.z * t, t };
}
/** これより低くなったらボールは床に着いたとみなす（resolveLooseContact の下限に合わせる）。 */
const FLOOR_Y = 0.32;
/**
 * リバウンドで守る側に付く、位置取りの有利さ。0 = 攻守同じ。
 * ⚠️ バランス差と同じ土俵に足す値なので、これを超えるバランス差があれば攻撃側が勝てる
 *    （能力で覆せる範囲に留める）。0 のときオフェンスリバウンドは 45%、0.45 で 26%。
 */
/** これより低いボールは「床のボール」。腰を折って手を伸ばして拾う。 */
const LOW_BALL = 0.45;
/** 床のボールへ手が届く水平距離(m)。立ったままの 0.6m より近い。 */
const LOW_REACH = 0.45;
/** 床のボールへ腰を折り始める距離(m)。走りながらこの形に入る。 */
const SCOOP_NEAR = 1.6;
/** 床の球を掴み切れる割合。1 未満だと弾いて争奪が続く。 */
const LOW_SECURE = 0.62;
const _dig = new Vector3();
const BOX_OUT_EDGE = 0.45;
/** 落下点の取り合いで、相手に前を取られていると判定する距離（m）。 */
const BOX_OUT_NEAR = 0.9;
/** 踏み切りで横へ詰められる距離(m)の上限。leap は飛行全体に配られるので頂点では半分。 */
const LEAP_MAX = 2.0;
/** 空中で体を傾けて寄せられる速さ(m/s)。床を踏んでいないので走るようには動けない。 */
const AIR_LEAN = 1.5;
/** 頂点でこの距離まで詰められないなら跳ばない(m)。resolveLooseContact の 0.6m より厳しく。 */
const GRAB_R = 0.45;
/** 相手の最高到達点をこれだけ上回れば「上を取った」＝競り負けない(m)。 */
const HIGH_POINT = 0.30;
/** この距離(m)以内にボールが落ちてくる選手は「もう競っている」とみなす。 */
const CONTEST_NEAR = 0.9;
/** 競っている選手が狙ってよい高さの余裕(m)。走る必要がないので目一杯まで手を出す。 */
const CONTEST_OVER = 0.08;
/** ボールの高さより手をどれだけ上に出すか(m)。上から被せて取るぶん。 */
const REACH_OVER = 0.30;
/** 計測用のフック（headless_sim のプローブが差す）。通常は何もしない。 */
export const REB_DEBUG: {
  onJump?: (p: Player, gap: number, t: number, h: number, blocked: number) => void;
  onEval?: (p: Player, planT: number, planH: number, gap: number, ready: boolean, lead: number) => void;
} = {};

export function chaseLoose(game: Game, dt: number): void {
    const bx = game.ball.pos.x, bz = game.ball.pos.z;
    const distToBall = (p: Player) => dist2DTo(p.pos, bx, bz);

    // 各選手のルーズボール反応遅延を減らす
    for (const p of game.players) if (p.looseReactT > 0) p.looseReactT -= dt;

    const contest = new Set<Player>();
    if (game.looseFromTip) {
      // 開始タップ: 狙われたガードに確保させ、最も近い相手1人だけが挑む。
      // それ以外は所定位置へ離れる（団子回避）。
      contest.add(game.tipoff.guard);
      const opp = nearestOf(game.teamPlayers(1 - game.tipoff.guard.team), distToBall);
      if (opp) contest.add(opp);
    } else {
      for (const team of [0, 1]) {                 // 各チームで最も近い者が行く
        contest.add(nearestOf(game.teamPlayers(team), distToBall)!);
      }
      const order = [...game.players].sort((a, b) => distToBall(a) - distToBall(b));
      for (const p of order) {                      // 3人まで足す。ただし本当に近い者だけ
        if (contest.size >= 3) break;
        if (!contest.has(p) && distToBall(p) < 2.5) contest.add(p);
      }
      // 専任リバウンダーは本物のリバウンド（ミスショット）の争奪だけに飛び込む。
      // ティップオフやスティールは対象外。
      for (const p of game.players) {
        if (p.evalRole === "リバウンダー" && game.looseIsRebound && distToBall(p) < 7) contest.add(p);
      }
    }

    for (const p of game.players) {
      if (contest.has(p)) {
        // まだ反応中 → 動き出していない（反応が速い相手が追走で先行する）
        if (p.looseReactT > 0) continue;
        // 立つ場所は**落下点**（動かない一点）。踏み切りだけ弾道の解 plan で決める。
        // ⚠️ plan（「ぎりぎり間に合う最も早い接触点」）へ走らせると、走るほど接触点が
        //    自分側へ寄ってくる＝目標が動き続け、落下点で構える形にならない。
        const plan = planCatch(game, p);
        const land = landSpot(game);
        // ⚠️ 空中の選手はここから先を触らない。以前は踏み切った後も毎フレーム地上と同じ
        //    ステアリングで**床の落下点**へ引っ張っていて、踏み込み(leap)で合わせた
        //    接触点から横へずらしていた。空中は弾道（leap）＋体を傾ける程度だけ。
        if (p.airborne) {
          const t = plan ?? land;
          moveToward2D(p.pos, t.x, t.z, AIR_LEAN * dt);
          continue;
        }
        const cv = game.steerAround(p, land.x, land.z);
        const gapNow = dist2DTo(p.pos, land.x, land.z);
        const spot = plan ?? land;   // 踏み切りで詰める先は接触点
        // 残り時間から必要な速さを出す。
        // ⚠️ 必要な速さをそのまま moveToward2D に渡してはいけない。accelSpeed を素通りする
        //    ので着地硬直（rootT の完全硬直・landT のスロットル）が効かず、**着地した
        //    瞬間に全速で動き出して床のボールを拾う**ようになっていた。倍率にして通す。
        const want = land.t > 0.05 ? gapNow / land.t : p.runSpeed;
        const lo = game.isBig(p) ? 1.0 : 0.9;
        const mult = clamp(want / Math.max(0.1, p.runSpeed), lo, 1.35);
        moveToward2D(p.pos, cv.x, cv.z, p.accelSpeed(dt, mult) * dt);
        game.clampCourt(p.pos);
        // 床のボールへは腰を折って手を伸ばす。走りながらでも同じ形で入る。
        // ⚠️ これが無いと、床のボールへは棒立ちのまま近づくだけだった。
        if (game.ball.pos.y < LOW_BALL && !p.airborne) {
          const near = dist2DTo(game.ball.pos, p.pos.x, p.pos.z);
          if (near < SCOOP_NEAR) {
            const t = clamp(1 - (near - LOW_REACH) / (SCOOP_NEAR - LOW_REACH), 0, 1);
            p.scoopLoadTarget = Math.max(p.scoopLoadTarget, t);
            _dig.set(game.ball.pos.x, Math.max(0.28, game.ball.pos.y), game.ball.pos.z);
            p.digReach(_dig);
          }
        }
        // 落下点の取り合い: 相手に前（落下点側）を取られていると踏み切りが遅れる
        let blocked = 0;
        for (const o of game.players) {
          if (o.team === p.team || o === p) continue;
          if (dist2DTo(o.pos, p.pos.x, p.pos.z) > BOX_OUT_NEAR) continue;
          const mine = gapNow, theirs = dist2DTo(o.pos, land.x, land.z);
          // ⚠️ リバウンドでは守る側にボックスアウトの分を足す。守備者はシュートの時点で
          //    相手とゴールの間に居るので、位置取りで先に入れる。これが無いと
          //    オフェンスリバウンドが 45% になっていた（実際のバスケットは 22〜28%）。
          const box = game.looseIsRebound && o.team !== game.looseOff ? BOX_OUT_EDGE : 0;
          if (theirs < mine) {
            blocked = Math.max(blocked,
              clamp(rate(o.attr.balance) - rate(p.attr.balance) + 0.25 + box, 0, 1));
          }
        }
        if (REB_DEBUG.onEval) {
          const d = plan ? clamp(0.34 + plan.h * 0.34, 0.34, 0.70) : 0;
          REB_DEBUG.onEval(p, plan ? plan.t : -1, plan ? plan.h : -1, gapNow,
            plan ? gapNow <= runDist(p, plan.t) + LEAP_MAX / 2 + 0.35 : false,
            d / 2 * (1 - blocked * 0.5));
        }
        if (plan && plan.h > 0.05) {
          // 頂点が到達時刻に合うよう、跳ぶ時間の半分だけ早く踏み切る。
          // 前を取られているとさらに遅れ、跳ぶ高さも下がる。
          // ⚠️ 滞空が長いほど「頂点の半分前」に踏み切るので、早く跳んで見える。
          //    実測で踏み切り時のボールの高さが 3.28m（まだリムの高さ）だった。短くする。
          const dur = clamp(0.30 + plan.h * 0.32, 0.30, 0.64);
          const lead = dur / 2 * (1 - blocked * 0.5);
          // 落下点に立てていないうちは跳ばない（跳んでも空振りして、着地後に拾う形になる）
          // planCatch が加速込みで到達可能な時刻しか返さないので、踏み込み(leap)の分だけ余裕を見る。
          const ready = gapNow <= runDist(p, plan.t) + LEAP_MAX / 2 + 0.35;
          if (plan.t <= lead + 0.03 && ready) {
            // ⚠️ 跳ぶ高さは plan.h ではなく**頂点の時刻のボールの高さ**から出す。plan.h だと
            //    少し早く踏み切った分ボールがまだ高く、実測で頂点のボールが手の上に残った。
            const th = dur / 2;                       // 頂点までの時間
            const byPeak = game.ball.pos.y + game.ball.vel.y * th - BALL_G * th * th / 2;
            const maxH = 0.55 + rate(p.attr.jump) * 0.45;
            // ⚠️ 「手がボールの高さちょうど」を狙うと実測で頂点の誤差が中央 0.00m になり、
            //    半分が数cm足りずに届かなかった。リバウンドはボールの上から被せて取るので、
            //    手が上に出る分を足す。
            const jh = clamp(byPeak - p.height * 1.35 + REACH_OVER, 0.08, maxH) * (1 - blocked * 0.18);
            // 頂点の時刻のボールの真下へ踏み込む。
            // ⚠️ 踏み込み先は plan（接触点）ではなく**頂点時刻のボール位置**。実測で頂点の
            //    水平距離が 0.60m（届く限界ちょうど）に残っていた。leap は飛行**全体**に
            //    配られるので、頂点(半分の時刻)で届かせるには 2 倍を渡す。
            const tx = game.ball.pos.x + game.ball.vel.x * th;
            const tz = game.ball.pos.z + game.ball.vel.z * th;
            const dx = tx - p.pos.x, dz = tz - p.pos.z;
            const gd = Math.hypot(dx, dz);
            const s = Math.min(2, LEAP_MAX / Math.max(0.01, gd)) * (1 - blocked * 0.25);
            // ⚠️ 取れない跳躍はしない。踏み切る瞬間に頂点の位置も高さも解けるので、
            //    頂点でボールに手が掛からないなら跳ばずに走り続けて地上で拾う。
            //    これが「跳んだ選手が取らずに近くの選手が確保する」の直接の原因だった。
            const restGap = gd * (1 - s / 2);            // 頂点で残る水平距離
            const canGrab = restGap <= GRAB_R
              && jh >= byPeak - p.height * 1.35 + 0.08;  // 伸び切りでは両手が添わない
            if (canGrab) {
              p.jump(jh, dur, dx * s, dz * s);
            }
            // 実際に踏み切れた時だけ記録する（着地硬直中は jump が空振りする）
            if (p.airborne) REB_DEBUG.onJump?.(p, gapNow, plan.t, jh, blocked);
          }
        } else if (!plan && game.ball.pos.y > 1.7 && distToBall(p) < 1.3) {
          // 弾道が読めない（はたかれた直後など）は従来どおり、頭の上へ来たら跳ぶ
          p.jump(0.55 + rate(p.attr.jump) * 0.45, 0.6);
        }
      } else {
        // 争っていない → 攻めの定位置へ流れて備える。ただし攻撃性が高いほど先行(先走り)、低い選手は
        // 確保が決まるまで先走らず備える(相手ボールになった時に守れる=まだ相手攻撃中に攻めへ行かない)。
        const eager = clamp((rate(p.attr.aggression) - 0.55) / 0.40, 0, 1);   // 攻撃性95→現状, 低→遅い
        const spot = game.formationSpots(p.team)[p.slot];
        moveToward2D(p.pos, spot.x, spot.z, p.accelSpeed(dt, 0.25 + eager * 0.6) * dt);
        game.clampCourt(p.pos);
      }
    }
  }

  // 競り合いの押し合い: ボール至近で相手と体が重なったら、ボディバランス差で弱い方を
  // ボール中心から外へずらす（強い方は踏みとどまり確保に近づく）。接触点でのボックスアウト。
  const SHOVE_RATE = 1.5;   // 最大バランス差での押し退け速度(m/s)
export function contestShove(game: Game, dt: number): void {
    const b = game.ball.pos;
    const near = game.players.filter((p) => dist2DTo(b, p.pos.x, p.pos.z) < 1.6);
    for (const p of near) {
      // ⚠️ 空中の選手は押されない。床を踏んでいないので押される支点が無く、実測では
      //    踏み込み(leap)で詰めた分をこの押し出しが打ち消して、頂点の水平距離が
      //    0.58m（届く限界ちょうど）に残っていた。
      if (p.airborne) continue;
      // 最も近い相手（体が重なる距離のみ）
      let q: Player | null = null, qd = 0.85;
      for (const o of near) {
        if (o.team === p.team) continue;
        const dd = dist2DTo(o.pos, p.pos.x, p.pos.z);
        if (dd < qd) { qd = dd; q = o; }
      }
      if (!q) continue;
      // リバウンドでは守る側が内側を取っているぶん、押し勝ちやすい。
      const box = game.looseIsRebound && q.team !== game.looseOff ? BOX_OUT_EDGE : 0;
      const edge = clamp(rate(q.attr.balance) - rate(p.attr.balance) + box, 0, 0.6);  // 相手が強い分だけ押される
      if (edge <= 0) continue;
      const rx = p.pos.x - b.x, rz = p.pos.z - b.z;                              // ボール中心から外向き
      const rl = Math.hypot(rx, rz) || 1;
      const push = edge * SHOVE_RATE * dt;
      p.pos.x += (rx / rl) * push;
      p.pos.z += (rz / rl) * push;
      game.clampCourt(p.pos);
    }
  }

  // ボールに手を掛けられる最も好位置の選手が接触する。
export function resolveLooseContact(game: Game, ): void {
    let best: Player | null = null;
    let bestReach = -Infinity;
    const reachers: Player[] = [];
    for (const p of game.players) {
      if (p.touchCool > 0) continue;
      if (p.looseReactT > 0) continue;   // まだ反応していない
      if (dist2DTo(game.ball.pos, p.pos.x, p.pos.z) > 0.6) continue;
      const top = p.reachTopY();
      if (game.ball.pos.y > top) continue;   // 高すぎて届かない
      // ⚠️ 以前は 0.3m 未満のボールを一律で除外していた。床を転がる球（静止時の
      //    中心高さ 0.12m）は接触判定に入らず、時間切れの安全網でしか手に入らな
      //    かった。腰を折って手を伸ばせば届くので、より近い距離で拾えるようにする。
      if (game.ball.pos.y < LOW_BALL
        && dist2DTo(game.ball.pos, p.pos.x, p.pos.z) > LOW_REACH) continue;
      reachers.push(p);
      if (top > bestReach) { bestReach = top; best = p; }
    }
    if (!best) return;
    // 競り: best 以外に同じボールへ手が届く相手がいれば競り合い(崩れて弾く)
    const contested = reachers.some((q) => q !== best && q.team !== best!.team);
    // 相手の最高到達点との差。最高打点で取りにいった側がどれだけ上を取れているか。
    let oppTop = -Infinity;
    for (const q of reachers) if (q.team !== best.team) oppTop = Math.max(oppTop, q.reachTopY());
    const edge = oppTop === -Infinity ? 1 : best.reachTopY() - oppTop;
    contactLooseBall(game, best, contested, edge);
  }

  // 手がボールに届く: 好位置で両手が添えば確保（キャッチ）、崩れ（伸び切り/横/競り）は
  // タップ（軌道をはじく）。何度もはじき続けたら確保させ、ピンボール化を防ぐ。
export function contactLooseBall(game: Game, p: Player, contested: boolean, edge = 1): void {
    game.lastTouch = p;   // 手が触れた — 以後のアウトオブバウンズを決める
    const horiz = dist2DTo(game.ball.pos, p.pos.x, p.pos.z);
    // ⚠️ 相手より高い位置で掴めているなら「競っている」扱いにしない。実測で、正しく
    //    跳んでボールに届いた 48 回のうち確保できたのは 24 回しかなく、残りは競り扱いで
    //    弾いていた（＝跳んだ選手が取らず、近くの選手が拾う）。最高打点を取った側が勝つ。
    const over = clamp(edge / HIGH_POINT, 0, 1);   // 1 = 相手より十分上で掴んでいる
    if (twoHandedCatch(p, game.ball.pos.y, horiz, contested && over < 0.5)) {
      secureLoose(game, p);
      return;
    }
    // ⚠️ ここで必ず弾いていた。twoHandedCatch は「最大リーチの 8cm 手前まで」しか
    //    両手確保にしないので、**リバウンドはほぼ全部が弾き**になり、実測で 61% が
    //    床まで落ちていた。能力で片手確保できるようにする。
    //    looseSecureChance（ジャンプ・反応・バランス・身長・ボックスアウトで確保率を
    //    出す関数）は定義だけされて一度も呼ばれていなかった。
    {
      const defending = p.team !== game.looseOff;
      let ch = looseSecureChance(p, defending, game.looseTips);
      if (contested) ch *= 0.45 + 0.55 * over;   // 競っていると落としやすい(上を取れていれば別)
      if (horiz > 0.45) ch *= 0.7;      // 体から遠いほど収まりにくい
      // 床の球は掻き出すだけになりやすい。相手も手を出していれば弾いて争奪が続く。
      if (game.ball.pos.y < LOW_BALL) ch *= LOW_SECURE;
      if (chance(ch)) { secureLoose(game, p); return; }
    }
    if (game.looseTips >= 3) { secureLoose(game, p); return; }   // ピンボール化させない
    game.looseTips++;
    flashBall(game, "tip", p.team);   // はたいた側の色（消えたらルーズの白へ戻る）
    // 自分の真上へ上げ直す（タップ・トゥ・セルフ）。競り合いで弾かれ続けて
    // ボールがすぐ場外へ流れるのを防ぐ。バランスと反応が高いほど成功しやすい。
    const ctl = 0.20 + rate(p.attr.balance) * 0.40 + rate(p.attr.reaction) * 0.25
      - (contested ? 0.30 : 0);
    if (chance(clamp(ctl, 0.05, 0.85))) {
      const vy = rand(3.6, 4.4);                       // 滞空 ~0.8-1.0秒（次のジャンプに間に合う）
      const t = vy / BALL_G;                           // 頂点までの時間
      // 頂点が自分の頭上へ来るように水平成分を決める（少し前へ落として取りやすく）
      const b = game.ball.pos;
      game.ball.vel.set((p.pos.x - b.x) / t, vy, (p.pos.z - b.z) / t);
      p.touchCool = 0.40;                              // 上げた直後に自分で触り直さない
      p.jump(0.35, 0.4);
      game.setEvent("TIP", p.team);
      return;
    }
    // 制御できなかった: 従来どおり上へ、外へはじく
    p.touchCool = 0.22;
    const a = rand(0, Math.PI * 2);
    game.ball.vel.set(Math.cos(a) * rand(0.6, 1.9), rand(2.4, 3.8), Math.sin(a) * rand(0.6, 1.9));
    p.jump(0.4, 0.45);
    game.setEvent("TIP", p.team);
  }

  // 選手がルーズボールを確保して着地し、プレイが再開する。
export function secureLoose(game: Game, p: Player, label?: string): void {
    game.lastTouch = p;
    // 掴んだ手の数を確定させる(画面に出ていた形と同じ判定)。この後の保持ポーズと
    // アウトレットの投げ方をここへ揃える。
    p.grabTwoHand = twoHandGrab(game, p, game.ball.pos);
    const offensive = p.team === game.looseOff;
    if (game.looseIsRebound) p.stats.reb++;   // ミスショットからのリバウンドだけを数える
    if (!offensive && game.looseStealBy) {    // 守備がはたき落としたボールを確保した
      game.looseStealBy.stats.stl++;          // スティールははたき出した者に記録
      if (game.looseStealVictim) game.looseStealVictim.stats.tov++;
    }
    game.looseStealBy = game.looseStealVictim = null;
    game.handler = p;
    flashBall(game, "secure", p.team);   // 確保した側の色
    game.possession = p.team;
    game.ballMode = "held";
    // ショットクロック: ポゼッション交代は完全リセット、リム接触のオフェンスリバウンドは
    // 部分リセット、それ以外のオフェンス確保はそのまま走らせる。
    if (!offensive) game.shotClock = SHOT_CLOCK;
    else if (game.looseFromRim) game.partialShotClock();
    // 確保したボールが手に収まるまでの時間。パスを受けたときと同じ扱い(gatherT)で、
    // この間はボールがまだ緩い（strip の対象・ドリブルも出せない）。
    // ⚠️ これが無かったので、確保した次のフレームに速いパスを投げられていた
    //    （実測: 確保からパスまで 25% が 0.03 秒以内）。
    const hard = (p.airborne ? 0.18 : 0) + (game.ball.pos.y > 2.0 ? 0.12 : 0)
      + (p.grabTwoHand ? 0 : 0.14) + (game.looseTips > 0 ? 0.06 : 0);
    const settle = clamp((0.22 + hard) * (1.25 - rate(p.attr.handling) * 0.5), 0.18, 0.75);
    p.gatherT = p.gatherDur = settle;
    p.decisionT = Math.max(0.4, settle * 0.8);
    game.ball.vel.set(0, 0, 0);
    game.resetMotion();
    if (!offensive) game.maybeStartPush();   // ポゼッション交代 → 速攻を走らせる
    game.leakOut();          // 飛び出しランナーが走り出す
    // 空中でリバウンドを掴んだ: 着地を待たず、次tickでそのままプットバック/アウトレットへ。
    // オフェンスリバウンドかつリム至近ならプットバック、それ以外はアウトレット/キック。
    if (game.looseIsRebound && p.airborne && game.ball.pos.y >= 1.2) {
      const rimF = game.attackFloor(p.team);
      p.reboundGo = true;
      // 落ち際で掴んだ球は押し込めない(滞空が残っていないと一瞬で放り上げる形になる)
      p.reboundPutback = offensive && dist2DTo(p.pos, rimF.x, rimF.z) < PUTBACK_RANGE
        && p.jumpRemaining > 0.25;
    }
    // 確保: ボールを瞬間移動させず、今ある位置を起点に手元へ地続きで収める。
    // 起点を記録し、liveball の pickup が実位置→手元へ補間する(高い球=降ろす/横=引き寄せる/
    // 床=すくい上げ)。距離が遠い/高いほど収めに少し時間をかける。空中プットバック/アウトレット
    // (reboundGo)は次tickでシュート/パスへ移り pickup は消費されない(不成立で着地時のみ効く)。
    p.grabFromX = game.ball.pos.x;
    p.grabFromY = game.ball.pos.y;
    p.grabFromZ = game.ball.pos.z;
    {
      const gdx = game.ball.pos.x - p.pos.x, gdz = game.ball.pos.z - p.pos.z;
      const gd3 = Math.hypot(gdx, gdz, game.ball.pos.y - 0.95);
      // 床際のボールはしゃがんですくい上げるぶん時間がかかる(low=1 が床、0 が手元の高さ)。
      const low = clamp((0.95 - game.ball.pos.y) / 0.75, 0, 1);
      // 技術(handling)で短縮。10 → 約1.3倍、99 → 約0.7倍。
      const tech = 1.32 - rate(p.attr.handling) * 0.66;
      p.pickupT = p.pickupDur = clamp((0.18 + gd3 * 0.12 + low * 0.34) * tech, 0.14, 0.9);
    }
    // 拾い終わるまでは次の判断へ行かない(すくい上げ中に撃たない)
    p.decisionT = Math.max(p.decisionT, p.pickupDur);
    game.setEvent(label ?? (offensive ? "OFF. REBOUND" : "REBOUND"), p.team);
  }
