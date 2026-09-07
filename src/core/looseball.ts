// ルーズボール物理。自由球の飛翔・反射、選手の追走、接触判定、確保(secureLoose)を集約。
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
    if (by > stand + maxH) continue;                  // まだ高すぎて手が届かない
    const x = game.ball.pos.x + game.ball.vel.x * t;
    const z = game.ball.pos.z + game.ball.vel.z * t;
    if (dist2DTo(p.pos, x, z) > runDist(p, t) + 0.35) continue;   // そこまで走って間に合わない
    return { x, z, t, h: Math.max(0, by - stand) };
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
/** 落下点の取り合いで、相手に前を取られていると判定する距離（m）。 */
const BOX_OUT_NEAR = 0.9;
/** 踏み切りで横へ詰められる距離(m)の上限。leap は飛行全体に配られるので頂点では半分。 */
const LEAP_MAX = 2.0;
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
        // 落下点の取り合い: 相手に前（落下点側）を取られていると踏み切りが遅れる
        let blocked = 0;
        for (const o of game.players) {
          if (o.team === p.team || o === p) continue;
          if (dist2DTo(o.pos, p.pos.x, p.pos.z) > BOX_OUT_NEAR) continue;
          const mine = gapNow, theirs = dist2DTo(o.pos, land.x, land.z);
          if (theirs < mine) blocked = Math.max(blocked, clamp(rate(o.attr.balance) - rate(p.attr.balance) + 0.25, 0, 1));
        }
        if (p.airborne) continue;
        if (REB_DEBUG.onEval) {
          const d = plan ? clamp(0.34 + plan.h * 0.34, 0.34, 0.70) : 0;
          REB_DEBUG.onEval(p, plan ? plan.t : -1, plan ? plan.h : -1, gapNow,
            plan ? gapNow <= runDist(p, plan.t) + LEAP_MAX / 2 + 0.35 : false,
            d / 2 * (1 - blocked * 0.5));
        }
        if (plan && plan.h > 0.05) {
          // 頂点が到達時刻に合うよう、跳ぶ時間の半分だけ早く踏み切る。
          // 前を取られているとさらに遅れ、跳ぶ高さも下がる。
          const dur = clamp(0.34 + plan.h * 0.34, 0.34, 0.70);
          const lead = dur / 2 * (1 - blocked * 0.5);
          // 落下点に立てていないうちは跳ばない（跳んでも空振りして、着地後に拾う形になる）
          // planCatch が加速込みで到達可能な時刻しか返さないので、踏み込み(leap)の分だけ余裕を見る。
          const ready = gapNow <= runDist(p, plan.t) + LEAP_MAX / 2 + 0.35;
          if (plan.t <= lead + 0.03 && ready) {
            // ⚠️ 跳ぶ高さは plan.h ではなく**頂点の時刻のボールの高さ**から出す。plan.h だと
            //    少し早く踏み切った分ボールがまだ高く、実測で頂点のボールが手の上に残った。
            const th = dur / 2;
            const byPeak = game.ball.pos.y + game.ball.vel.y * th - BALL_G * th * th / 2;
            const maxH = 0.55 + rate(p.attr.jump) * 0.45;
            // 少し余裕を見て跳ぶ（フレーの丸めと踏み切りのされで、実測でボールが手の 0.18m 上に残った）
            const jh = clamp(byPeak - p.height * 1.35 + 0.10, 0.08, maxH) * (1 - blocked * 0.35);
            // 残った横のズレは踏み込み(leap)で詰める。leap は飛行**全体**に配られるので、
            // 頂点(半分の時刻)で届かせるには 2 倍を渡す。
            // ⚠️ 倍率は「落下点までの距離(gapNow)」ではなく**接触点までの距離**で出す。
            //    立つ場所(落下点)と接触点は最大 1.2m ほどずれるので、取り違えると詰め足りない。
            const gapSpot = dist2DTo(p.pos, spot.x, spot.z);
            const s = Math.min(2, LEAP_MAX / Math.max(0.01, gapSpot)) * (1 - blocked * 0.5);
            p.jump(jh, dur, (spot.x - p.pos.x) * s, (spot.z - p.pos.z) * s);
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
      // 最も近い相手（体が重なる距離のみ）
      let q: Player | null = null, qd = 0.85;
      for (const o of near) {
        if (o.team === p.team) continue;
        const dd = dist2DTo(o.pos, p.pos.x, p.pos.z);
        if (dd < qd) { qd = dd; q = o; }
      }
      if (!q) continue;
      const edge = clamp(rate(q.attr.balance) - rate(p.attr.balance), 0, 0.6);  // 相手が強い分だけ押される
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
      if (game.ball.pos.y > top || game.ball.pos.y < 0.3) continue; // 高すぎ／低すぎて届かない
      reachers.push(p);
      if (top > bestReach) { bestReach = top; best = p; }
    }
    if (!best) return;
    // 競り: best 以外に同じボールへ手が届く相手がいれば競り合い(崩れて弾く)
    const contested = reachers.some((q) => q !== best && q.team !== best!.team);
    contactLooseBall(game, best, contested);
  }

  // 手がボールに届く: 好位置で両手が添えば確保（キャッチ）、崩れ（伸び切り/横/競り）は
  // タップ（軌道をはじく）。何度もはじき続けたら確保させ、ピンボール化を防ぐ。
export function contactLooseBall(game: Game, p: Player, contested: boolean): void {
    game.lastTouch = p;   // 手が触れた — 以後のアウトオブバウンズを決める
    const horiz = dist2DTo(game.ball.pos, p.pos.x, p.pos.z);
    if (twoHandedCatch(p, game.ball.pos.y, horiz, contested)) {
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
      if (contested) ch *= 0.45;        // 競っていると落としやすい
      if (horiz > 0.45) ch *= 0.7;      // 体から遠いほど収まりにくい
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
    p.decisionT = 0.4;
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
