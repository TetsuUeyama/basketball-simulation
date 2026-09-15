// オフボール移動: 誰が今スポットに立ち、誰がカット/スクリーン/マーク外しに動くか。
// 立ち位置の選定と間合いの取り方は ./spots、スクリーンの実体は move/action/screen。
import { Vector3 } from "@babylonjs/core";
import { Player } from "../../../objects/player/player";
import { RIM, THREE_DIST } from "../../../config";
import { rate, clamp, chance, rand, dist2D, dist2DTo, moveToward2D, dirTo2D, segPerp } from "../../../util";
import { deepThreeOK } from "../../../eval";
import { laneBlock } from "../../../move/reaction/pass-risk";
import { countScreening, handlerPressured, goodScreener, setScreen, updateScreen } from "../../../move/action/screen";
import { tightlyTrapped, trapReliever, trapReliefSpot } from "../reads";
import { bestOpenSpot, spacingNudge, ballSpacingNudge, nearestTeammateDist } from "./spots";
import type { Game } from "../../../game";
import { attnTo } from "../../attention";

// オフボール全員の駆動: スポット確保、リムへのカット、ギブ&ゴー、オープンスポットへの
// ローテ、ボールから離れたスペーシング。
export function updateOffBallMotion(game: Game, dt: number, team: number, exclude: Player | null): void {
  const spots = game.formationSpots(team);
  const rim = game.attackFloor(team);
  for (const p of game.teamPlayers(team)) {
    if (p === exclude) continue;
    if (p.rooted) continue;   // パス/シュートのフォロースルー中 — 保持

    // スローイン後の前進(トラップ救済より優先): 非PMビッグの投げ手はバックコートに
    // 残らず、自分側のフロントコート(ローブロック)へ全力で抜ける。ガードが降りて組み立てる。
    if (p.frontRunT > 0) {
      if (game.frontT) { p.frontRunT = 0; }   // フロントコート確立で解除→通常のポスト play
      else {
        p.frontRunT = Math.max(0, p.frontRunT - dt);
        const s = game.attackSign(team);
        const side = p.pos.x >= 0 ? 1 : -1;
        const tx = side * 2.8, tz = s * RIM.z - s * 1.4;   // フォーメーションのローブロック相当
        moveToward2D(p.pos, tx, tz, p.accelToward(dt, tx, tz, 1.2) * dt);
        game.clampCourt(p.pos);
        p.cutting = false;
        continue;
      }
    }

    // トラップ救済(最優先): ハンドラーがダブルチーム時、味方1人がボールへフラッシュしアウトレットを作る。
    if (game.handler && game.handler !== p && tightlyTrapped(game, game.handler)
        && p === trapReliever(game, team)) {
      const t = trapReliefSpot(game, game.handler);
      moveToward2D(p.pos, t.x, t.z, p.accelToward(dt, t.x, t.z, 1.2) * dt);
      spacingNudge(game, dt, p, 1.6);
      game.clampCourt(p.pos);
      p.cutting = false;
      continue;
    }

    // 運び上げの支援: 最良の非ビッグ・ハンドラー候補(ガード)が常にハンドラーの近くへ
    // 降りて逃がし所を作る。プレス時はより近く。これで苦し紛れのパスもビッグでなくガードへ。
    if (!game.frontT && game.handler && game.handler !== p && dist2D(game.handler.pos, rim) > 9) {
      const outlet = game.teamPlayers(team)
        .filter((q) => q !== game.handler && !game.isBig(q) && q.frontRunT <= 0)
        .sort((a, b) => b.playmaking - a.playmaking)[0];
      if (p === outlet) {
        const s = game.attackSign(team);
        const bx = game.handler.pos.x, bz = game.handler.pos.z;
        const pressed = game.isBig(game.handler)
          || game.nearestDefenderDist(game.handler) < 1.7
          || laneBlock(game.oppTeam(game.handler), game.handler, p) !== null;
        // ハンドラーの逆サイド・ほぼ同じ高さに付いて安全な逃がし所を作る(スペーシング確保)。
        const sideX = bx >= 0 ? -1 : 1;
        const otx = sideX * (pressed ? 3.0 : 4.2);
        // ⚠️ ハンドラーより**後ろに立たない**。運び上げ中に後退する絵になる
        //    （実測: 運び上げ中の後退命令 7833フレーム/4試合がこの分岐だった）。
        //    プレス時は同じ高さ、余裕があれば half 歩前で逃がし所を作る。
        // ⚠️ 前へ運んでいる最中は**後退しない**。既にハンドラーより前に居るなら、
        //    その高さを保つ（下がって迎えに行かない）。
        const otzRaw = bz + s * (pressed ? 0.0 : 1.0);
        const otz = s > 0 ? Math.max(otzRaw, p.pos.z) : Math.min(otzRaw, p.pos.z);
        moveToward2D(p.pos, otx, otz, p.accelToward(dt, otx, otz, pressed ? 1.25 : 1.0) * dt);
        game.clampCourt(p.pos);
        continue;
      }
    }

    // レーンを埋める: 速攻でウィング(ハンドラー以外)が自分の側をリムへ走り込む。ビッグは後追い。
    // 攻撃性が高いほど即走り出し(95=現状)、低い選手は攻撃への移行が遅く遅れて上がる。
    // ⚠️ フロントコートを確立し、ハンドラーが速攻を畳んだ（止まっている）なら、
    //    レーン埋めは終わり。持ち場へ移る。
    if (game.pushT > 0 && game.handler && p !== game.handler && !game.isBig(p)
        && !(game.frontT && game.handler.stillT > 0.6)) {
      const eager = clamp((rate(p.attr.aggression) - 0.55) / 0.40, 0, 1);
      const s = game.attackSign(team);
      const side = p.pos.x >= 0 ? 1 : -1;
      const fb = game.steerAround(p, side * 4.5, s * (RIM.z - 1.5));
      // ⚠️ 下限 0.55 倍は遅すぎる。攻撃性の低い選手がセンターライン付近をダラダラ上がり、
      //    「攻めているのに守備に戻っているように見える」原因になっていた
      //    （実測: フロントコート確立後にセンター付近で止まっている選手のうち 75件がここ）。
      //    速さの差は残しつつ、下限を上げる。
      moveToward2D(p.pos, fb.x, fb.z, p.accelToward(dt, fb.x, fb.z, 0.85 + eager * 0.5) * dt);
      game.clampCourt(p.pos);
      continue;
    }

    // パスコースを潰されているか（毎フレーム）。外しの判断と注目システムが見る。
    markFronted(game, p);
    // 司令塔(とキープで時間を作るハンドラー)がチーム全体の再配置を速める
    let tick = game.teamHas(team, "general") ? 1.3 : 1;
    if (game.handler?.has("keepDribble")) tick *= 1.2;
    if (p.has("positioning")) tick *= 1.25;
    // ⚠️ ハンドラーが止まって膠着したら、**その様子が見えている**味方は動き直す
    //    （合わせのカット / スポットの入れ替え）。全員を一律に動かすと、ボールを見て
    //    いない選手まで「止まったこと」を知っていることになる（注目システムに反する）。
    //    実測: ハンドラーが止まると他の9人の停止率が 24.8% → 45.5% に跳ねていた。
    if (game.handler && game.handler !== p && game.handler.stillT > 0.8) {
      tick *= 1 + attnTo(p, game.handler) * 1.2;   // 見ている選手ほど早く動き直す
    }
    p.offTimer -= dt * tick;

    if (p.screening) {
      updateScreen(game, dt, p);
    } else if (p.cutting) {
      // カットに沿って走る(スポットより少し速い)。走路の守備を避けて曲がる。
      const ct = game.steerAround(p, p.offTarget.x, p.offTarget.z, true);
      moveToward2D(p.pos, ct.x, ct.z,
        p.accelToward(dt, ct.x, ct.z, p.has("lineMove") ? 1.22 : 1.08) * dt);
      spacingNudge(game, dt, p, 1.7);
      if (dist2DTo(p.pos, p.offTarget.x, p.offTarget.z) < 0.6) {
        const atRim = dist2DTo(p.offTarget, rim.x, rim.z) < 1.6;
        if (atRim) {
          // リムでボールをもらえなかった — オープンスポットへ抜ける
          p.spotIdx = bestOpenSpot(game, team, spots, p);
          p.offTarget.copyFrom(spots[p.spotIdx]);
        } else {
          p.cutting = false;
          p.offTimer = rand(2.5, 4.5);
        }
      }
    } else if (clearDriveLane(game, dt, p)) {
      // このフレームはハンドラーのドライブレーンから退いた
    } else if (isoHandler(game)) {
      // 釣り出し: スターがボール — 自分の守備を外へ広く釘付け
      const t2 = isoSpreadTarget(game, p, isoHandler(game)!);
      moveToward2D(p.pos, t2.x, t2.z, p.accelToward(dt, t2.x, t2.z) * dt);
      spacingNudge(game, dt, p, 1.7);
      game.clampCourt(p.pos);
    } else if (p.shakeOpenT > 0) {
      // マーク外し中: 分離方向へバーストして空きを作る（クイックは離れる、パワーはシールを押し込む）。
      // ⚠️ クイックは**直線ではなく曲げる**。切り返し／円を描く動きで、付いてくる守備の
      //    足を止めさせる。曲がりの速さは敏捷で決まる（shakeCurve）。
      if (p.shakeCurve !== 0) {
        const a = p.shakeCurve * dt;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx2 = p.shakeDirX * ca - p.shakeDirZ * sa;
        const nz2 = p.shakeDirX * sa + p.shakeDirZ * ca;
        p.shakeDirX = nx2; p.shakeDirZ = nz2;
      }
      // ⚠️ 追う守備は deny 中 1.25 倍で動く。攻撃が 1.15 倍だと**守備のほうが速く**、
      //    サイコロで「外せた」ことになっても 0.5秒後には詰められている
      //    （実測: クイックの外しで距離が中央 -0.19m＝逆に縮んでいた）。
      //    振り切る側のほうが速いこと。パワーは走らずに体を入れるので低いまま。
      const burst = p.shakePower ? 0.85 : 1.32;
      const tx = p.pos.x + p.shakeDirX * 2.0, tz = p.pos.z + p.shakeDirZ * 2.0;
      moveToward2D(p.pos, tx, tz, p.accelToward(dt, tx, tz, burst) * dt);
      spacingNudge(game, dt, p, 3.2);
      game.clampCourt(p.pos);
    } else {
      let spot = spots[p.spotIdx];
      const atPost = p.spotIdx >= 5;
      // ダンカースライド: ハンドラーがペイントへドライブしたら、ブロックのビッグはベース
      // ライン沿いに自分側のショートコーナーへ退きリムを空ける
      if (atPost && game.handler
          && ((game.handler.beatenT > 0 || game.handler.powerT > 0)
                && dist2D(game.handler.pos, p.pos) < 6.5
              || dist2D(game.handler.pos, p.pos) < 3.2)) {
        const s = game.attackSign(team);
        const sx = (spot.x || p.pos.x) > 0 ? 1 : -1;
        const tx = sx * 4.8, tz = s * (RIM.z - 0.9);
        moveToward2D(p.pos, tx, tz, p.accelToward(dt, tx, tz, 1.1) * dt);
        spacingNudge(game, dt, p, 1.6);
        game.clampCourt(p.pos);
        continue;
      }
      // スポットが混んだら再配置(ハンドラー/味方が近づいた)。ボールのトリガは広め(4.8m)、
      // 味方が近い(過密)なら空きスペースへ移す。
      if ((game.handler && dist2DTo(game.handler.pos, spot.x, spot.z) < 4.8)
          || nearestTeammateDist(game, p) < (atPost ? 2.3 : 3.8)) {
        p.spotIdx = bestOpenSpot(game, team, spots, p);
        spot = spots[p.spotIdx];
      }
      // ディープシューター(L精度/L速度とも90+)だけはスポットより一歩外へ
      let spx = spot.x, spz = spot.z;
      if (deepThreeOK(p)) {
        const dxs = spot.x - rim.x, dzs = spot.z - rim.z;
        const dl = Math.hypot(dxs, dzs);
        if (dl > THREE_DIST - 0.4) {
          const k = (dl + 1.1) / dl;
          spx = rim.x + dxs * k;
          spz = rim.z + dzs * k;
        }
      }
      // ⚠️ 持ち場に着いたら**止まらない**。止まった状態から仕掛けると、外しの 1.2 秒では
      //    加速し切れず守備に置いていかれる（実測: 外し中 攻 1.92 / 守 1.71 m/s で
      //    1秒後の距離が ±0m）。スポットの周りをゆっくり回り続け、足を作っておく。
      //    速い選手ほど大きく・速く回る（フリーランニング）。
      let spx2 = spx, spz2 = spz;
      if (game.frontT && dist2DTo(p.pos, spx, spz) < 1.6 && p.spotIdx < 5) {
        const runner = rate(p.attr.agility) * 0.5 + rate(p.attr.speed) * 0.3
          + rate(p.attr.stamina) * 0.2;
        const r = 0.7 + runner * 0.9;                       // 回る半径(m)
        const w = 0.8 + runner * 1.1;                       // 回る速さ(rad/s)
        p.freePhase += dt * w * (p.idx % 2 === 0 ? 1 : -1);  // 選手ごとに逆回り
        spx2 = spx + Math.sin(p.freePhase) * r;
        spz2 = spz + Math.cos(p.freePhase) * r * 0.6;        // 横に広く、縦は控えめ
      }
      // ⚠️ 持ち場が遠いとき、目標へ一直線に向かうと全員がコート中央を通る
      //    （実測: ウイングの持ち場は |x|=5.66m なのに実際は 3.48m、コーナーは
      //    　6.80m に対し 3.72m と、2〜3m 内側に寄っていた。ワイドレーン(|x|>4m)に
      //    　居るのは平均1.7人で、12.9% は 0人だった）。
      //    **先に自分のレーンへ開いてから上がる**＝斜めに走ってコート幅を使う。
      //    縦の詰めを半分に抑えるだけなので、行ける場所を制限しているわけではない。
      {
        const gap = dist2DTo(p.pos, spx2, spz2);
        const wide = Math.abs(spx2) > 3.5;   // ウイング/コーナーなど外の持ち場
        if (gap > 3.5 && wide && Math.abs(p.pos.x) < Math.abs(spx2) - 1.0) {
          spz2 = p.pos.z + (spz2 - p.pos.z) * 0.45;   // 横へ開くのを先行させる
        }
      }
      const sj = game.steerAround(p, spx2, spz2, true);   // 通り抜けず迂回
      // ⚠️ 持ち場へはジョグで向かっていた（倍率指定なし=1.0）。実測で攻撃移行中の速度は
      //    走力の 43% しかなく、守備がセットし切ってから攻撃が始まっていた。
      //    遠い間は守備の全力復帰(1.12〜1.15倍)と同じ勢いで走り、近づいたら通常へ戻す。
      const farSpot = dist2DTo(p.pos, sj.x, sj.z);
      const hustle = clamp(0.98 + farSpot * 0.09, 0.98, 1.15);
      if (farSpot > 3) p.transitT = 0.2;   // 走る姿勢（構えでなく進行方向へ胸を向ける）
      moveToward2D(p.pos, sj.x, sj.z, p.accelToward(dt, sj.x, sj.z, hustle) * dt);
      spacingNudge(game, dt, p, atPost ? 2.0 : 4.2);   // 味方と近づきすぎない（間合いを広く）
      // ボールからの連続的な分離: ドリブラーが寄ってきたら離れる(ドライブ/パスコースのスペース確保で強め)
      ballSpacingNudge(game, dt, p, atPost ? 2.4 : 5.2);
      // マーク外し: 担当守備を振り切ってパスコースを作る（クイックネス or パワー勝負）
      tryShake(game, dt, p);

      if (p.offTimer <= 0) {
        p.offTimer = rand(2.0, 4.0);
        pickOffBallAction(game, team, spots, p);
      }
    }

    game.clampCourt(p.pos);
  }
}

// スポットを一定時間保った後の次の動き: スクリーン設定 / バスケットカット / より
// オープンなスポットへドリフト。同時にスクリーナー/カッターは最大1人で間合いを保つ。
/** 中にポストが居るときのカットの起こりやすさ。1 = 変わらず。
 *  ⚠️ 0.55 では中に人が居るだけでカットがほぼ止まっていた。空いている側から入る
 *     ようにしたので、抑える必要は小さい。 */
const POST_HOME_CUT = 0.85;

function pickOffBallAction(game: Game, team: number, spots: Vector3[], p: Player): void {
  const rim = game.attackFloor(team);
  const busy = countScreening(game, team);   // 他のスクリーナーのみ排他（カットとは併存可）
  const screenChance = (game.isBig(p) ? 1.0 : 0.6) * (p.evalRole === "スクリーナー" ? 1.5 : 1);
  if (busy === 0 && handlerPressured(game) && goodScreener(game, p) && chance(screenChance)) {
    setScreen(game, p);
    return;
  }
  // ステーションのポストビッグがいるとカットのスペースが減る
  const postHome = game.teamPlayers(team)
    .some((q) => q !== p && q.spotIdx >= 5 && !q.cutting && !q.screening);
  // ⚠️ 膠着（ハンドラーが止まっている）ときは、カットは2人まで許す。1人に絞ると
  //    残り3人が立ち尽くす。
  const stalledCut = !!game.handler && game.handler.stillT > 0.8;
  if (countCutting(game, team) <= (stalledCut ? 1 : 0)
      && !(game.handler && (game.handler.beatenT > 0 || game.handler.powerT > 0
        || game.handler.jukeT > 0))
      && chance((0.2 + p.offPriority * 0.25 + rate(p.attr.aggression) * 0.15
        + (p.has("lineMove") ? 0.15 : 0)) * (postHome ? POST_HOME_CUT : 1))) {
    p.cutting = true;
    // ポストが占有していればエルボーへ、空いていればリムまで
    let occL = false, occR = false;
    for (const q of game.teamPlayers(team)) {
      if (q !== p && q.spotIdx >= 5 && !q.cutting && !q.screening) {
        if (spots[q.spotIdx].x > 0) occR = true; else occL = true;
      }
    }
    const sgn = Math.sign(rim.z);
    let tx: number, tz: number;
    if (occL || occR) {
      // ⚠️ 以前はポストが居るだけでエルボー止まりにしていた。中に1人しか置かない
      //    配置にしたのに誰もリムへ入らず、実測でゴール下の試投が 5.6 本/試合まで
      //    落ちた。**空いている側からリムへ入る**。
      const ex = occR ? -1 : occL ? 1 : (chance(0.5) ? 1 : -1);
      tx = rim.x + ex * rand(0.8, 1.7);
      tz = rim.z - sgn * rand(0.5, 1.6);            // 空いている側のリム下
    } else {
      tx = rim.x + rand(-0.6, 0.6);
      tz = rim.z - sgn * 0.4;                       // リムまで
    }
    // 走路がステーションのビッグ/ハンドラーを貫くならカットしない
    if (!cutLaneClear(game, team, p, tx, tz)) { p.cutting = false; return; }
    p.offTarget.set(tx, 0, tz);
    return;
  }
  // それ以外はパスレーンを開け、ドライブギャップを空けるよう再配置
  // ⚠️ ハンドラーが止まって膠着しているのに同じスポットを選び直すと、その場に立ったままに
  //    なる（実測: 止まっている選手の 232/482 は「目標＝今いる場所」だった）。
  //    膠着が**見えている**選手は、今のスポットを外して別の空きへ動き直す。
  const stalled = !!game.handler && game.handler !== p && game.handler.stillT > 0.8
    && attnTo(p, game.handler) > 0.55;
  if (stalled || chance(game.teamHas(team, "general") ? 0.7 : 0.5)) {
    const cur = p.spotIdx;
    p.spotIdx = bestOpenSpot(game, team, spots, p, stalled ? cur : -1);
  }
}

// マーク外し: 担当守備者を振り切って自分へのパスコースを作る。守備が近く(deny)て
// 1パスアウェイの時だけ発動。クイックネス(offense+敏捷 vs 守備+敏捷)か、パワー
// (バランスで背中に押し込む vs 守備のバランス)の勝負。成功で shakeOpenT を立て、
// deny が緩む＋守備の読みが鈍る＝オープンになりパスを呼び込む。
/**
 * 自分とボールの間に守備が入っているか（＝パスコースを潰されている）。
 * ⚠️ 「近いかどうか」ではなく**レーンに入っているか**で見る。横に張り付かれているのと
 *    前を取られているのとでは、攻撃側の答え（バックドア/シール）が変わる。
 */
function frontedBy(game: Game, p: Player, d: Player): boolean {
  const h = game.handler;
  if (!h) return false;
  const bx = h.pos.x - p.pos.x, bz = h.pos.z - p.pos.z;
  const bl = Math.hypot(bx, bz);
  if (bl < 0.8) return false;
  const dx = d.pos.x - p.pos.x, dz = d.pos.z - p.pos.z;
  const along = (dx * bx + dz * bz) / bl;              // ボール方向の成分
  if (along <= 0.15 || along > bl) return false;        // 自分の後ろ／ボールの向こう側
  const off = Math.abs(dx * bz - dz * bx) / bl;         // レーンからの横ずれ
  return off < 0.95;
}

/**
 * 「パスコースを潰されているか」を毎フレーム更新する。
 * ⚠️ 以前は tryShake の中で見ていたが、tryShake は試行のクールダウン(1.4〜2.8秒)で
 *    早期 return するので、**潰されていても印が立たない**フレームが大半だった
 *    （実測: 潰された状態が続いた時間の中央値が 0.42秒しかなかった）。
 *    印は注目システム（マーカーを見る）と外しの判断の両方が見るので、毎フレーム要る。
 */
function markFronted(game: Game, p: Player): boolean {
  const d = game.teamPlayers(1 - p.team)[p.slot];
  if (!d || !game.handler || game.handler === p) return false;
  const fronted = frontedBy(game, p, d);
  if (fronted) p.frontedT = 0.12;     // 毎フレーム更新するので短くてよい
  return fronted;
}

function tryShake(game: Game, dt: number, p: Player): void {
  const fronted = p.frontedT > 0;
  if (p.shakeT > 0 || !game.handler || game.handler === p) return;
  const d = game.teamPlayers(1 - p.team)[p.slot];   // 担当守備者(index一致)
  if (!d) return;
  // 走り続ける選手は、少し離されていても動き直してスペースを作る
  const reach = 2.2 + rate(p.attr.agility) * 1.0;
  if (dist2D(d.pos, p.pos) > reach && !fronted) return; // 十分空いている → 不要
  if (dist2D(p.pos, game.handler.pos) > 7) return;   // ウィークサイドは対象外
  // ⚠️ 走り続けてスペースを作る選手（フリーランニング）は、1回外して終わりではなく
  //    **連続して**仕掛ける。クイックネスと持久力で次の仕掛けまでの間隔が縮む。
  const runner = rate(p.attr.agility) * 0.45 + rate(p.attr.speed) * 0.3
    + rate(p.attr.stamina) * 0.25;
  p.shakeT = rand(1.4, 2.8) * (1 - runner * 0.62);   // 試行クールダウン（速い選手ほど短い）
  // どちらで勝負するかは、まず**その場所でなければ困るか**で決まる。
  //   ・場所が入れ替わってよい（アークで受けて撃つ/そこから突く）→ スピードで空きへ走る
  //   ・その場所でないと意味が無い（ゴール下の位置取り、リバウンド前）→ 押して無力化する
  // 能力はその次（同じ場面でも、体が強い選手は押し勝ち、速い選手は走り勝つ）。
  const rimF = game.attackFloor(p.team);
  const spotMatters = p.spotIdx >= 5 || dist2D(p.pos, rimF) < 4.5;
  const power = spotMatters
    ? (game.isBig(p) ? rate(p.attr.balance) > 0.35 : rate(p.attr.balance) > 0.55)
    : (game.isBig(p) && rate(p.attr.balance) > 0.72 && chance(rate(p.attr.balance) - 0.5));
  if (power) {
    // パワー: バランスで守備を背中に押し込みパスコースを確保
    const off = rate(p.attr.balance) * 0.8 + rate(p.attr.aggression) * 0.2;
    const def = rate(d.attr.balance) * 0.8 + rate(d.attr.defense) * 0.2;
    // 前を取られているときは、体で押し返してレーンへ入り直す勝負（接触で勝つ）。
    if (chance(clamp((fronted ? 0.40 : 0.45) + (off - def) * (fronted ? 1.1 : 0.9), 0.1, 0.9))) {
      p.shakeOpenT = rand(1.0, 1.5);
      p.shakePower = true;
      p.shakeCurve = 0;                   // シールは体を入れて止まる＝曲げない
      // ボール→自分 の延長方向へシール（守備を背にボールを呼び込む）
      const bx = p.pos.x - game.handler.pos.x, bz = p.pos.z - game.handler.pos.z;
      const bl = Math.hypot(bx, bz) || 1;
      p.shakeDirX = bx / bl; p.shakeDirZ = bz / bl;
    }
  } else {
    // クイックネス: offense+敏捷 が 守備の defense+敏捷 を上回れば振り切る
    const off = rate(p.attr.offense) * 0.45 + rate(p.attr.agility) * 0.55;
    const def = rate(d.attr.defense) * 0.5 + rate(d.attr.agility) * 0.5;
    // ⚠️ 前を取られている（レーンに入られている）ときの答えは横ではなく**バックドア**。
    //    守備はボールを見てレーンに体を入れているので、裏（リム方向）が空いている。
    //    その守備がボールを見ているほど決まりやすい（注目システム）。
    const blind = fronted ? 1 - attnTo(d, p) * 0.55 : 0;   // 0.45..1（自分を見られていないほど大）
    const win = fronted
      ? clamp(0.38 + (off - def) * 0.9 + blind * 0.35, 0.1, 0.94)
      : clamp(0.42 + (off - def) * 1.1, 0.08, 0.92);
    if (chance(win)) {
      p.shakeOpenT = rand(1.1, 1.7);   // 走り切る時間が要る（短いと加速し切る前に終わる）
      p.shakePower = false;
      // ⚠️ プラント（切り返しの再加速の罰）を解く。あれは**不意の方向転換**の罰で、
      //    自分から仕掛けるカットは足を作ってから踏み切る。残したままだと、外している
      //    時間の 33% が罰の中に入り、走る速さの 22% しか出ずに守備（1.78m/s）へ
      //    置いていかれる（実測: 0.5秒後にむしろ 0.06〜0.19m 詰められていた）。
      p.plantT = 0; p.coolT = 0;
      if (fronted) {
        // バックドア: ボールから離れる向き＝守備の背中側へ抜ける
        const rim = game.attackFloor(p.team);
        const ax = (p.pos.x - game.handler.pos.x) * 0.5 + (rim.x - p.pos.x);
        const az = (p.pos.z - game.handler.pos.z) * 0.5 + (rim.z - p.pos.z);
        const al = Math.hypot(ax, az) || 1;
        p.shakeDirX = ax / al; p.shakeDirZ = az / al;
        p.backdoorT = 1.0;
        p.shakeCurve = 0;                 // バックドアは最短距離で裏へ抜ける
      } else {
        // ⚠️ 場所が入れ替わってよい場面なので、狙いは「守備から離れる」ではなく
        //    **空いている所へ走る**（フリーで受けられる場所を作る）。8方向を試して、
        //    守備から遠く・パスコースが通り・アークの内側に残る方向を選ぶ。
        const rim2 = game.attackFloor(p.team);
        let bestS = -Infinity, bx = 0, bz = 0;
        for (let k = 0; k < 8; k++) {
          const th = (k / 8) * Math.PI * 2;
          const ux = Math.sin(th), uz = Math.cos(th);
          const tx2 = p.pos.x + ux * 3.0, tz2 = p.pos.z + uz * 3.0;
          let near = Infinity;
          for (const q of game.teamPlayers(1 - p.team)) {
            near = Math.min(near, dist2DTo(q.pos, tx2, tz2));
          }
          let mate = Infinity;
          for (const q of game.teamPlayers(p.team)) {
            if (q === p) continue;
            mate = Math.min(mate, dist2DTo(q.pos, tx2, tz2));
          }
          const lane = laneBlock(game.teamPlayers(1 - p.team), game.handler, {
            pos: { x: tx2, z: tz2 },
          } as unknown as Player) ? 0 : 1;
          const band = dist2DTo(rim2, tx2, tz2);
          const outPen = Math.max(0, band - (THREE_DIST + 0.8)) * 1.5;   // アークの外へは走らない
          const inPen = Math.max(0, 3.0 - band) * 0.8;                   // 中へ突っ込みすぎない
          const sc = Math.min(near, 5) * 1.4 + Math.min(mate, 5) * 0.6 + lane * 2.2 - outPen - inPen;
          if (sc > bestS) { bestS = sc; bx = ux; bz = uz; }
        }
        p.shakeDirX = bx; p.shakeDirZ = bz;
        // 速い選手は掴まらないように曲げて逃げる。切り返し（鋭い）か、円を描く（緩い）。
        const quickness = rate(p.attr.agility) * 0.6 + rate(p.attr.speed) * 0.4;
        const sharp = chance(0.45 + quickness * 0.3);      // 速いほど切り返しを選ぶ
        // 曲げる向きは「守備が居ない側」へ。守備の居る側へ回ると自分から捕まりに行く。
        const away = (p.pos.x - d.pos.x) * bz - (p.pos.z - d.pos.z) * bx;
        const turn = away >= 0 ? 1 : -1;
        p.shakeCurve = (sharp ? -turn : turn) * (1.4 + quickness * (sharp ? 4.0 : 2.2));
      }
    }
  }
}

function countCutting(game: Game, team: number): number {
  let n = 0;
  for (const p of game.teamPlayers(team)) if (p.cutting) n++;
  return n;
}

// 今仕掛けている1対1のスター(エース/スラッシャー)。フロントコートでボールを持つと
// フロアが空けられる。
function isoHandler(game: Game): Player | null {
  const h = game.handler;
  if (!h || !game.frontT) return null;
  return (h.evalRole === "エース" || h.evalRole === "スラッシャー") ? h : null;
}

// 釣り出し(重力スプレッド): スターが仕掛ける間、皆がどこに立つか。両コーナーと逆サイド
// ディープウィング、(非ストレッチの)ビッグは逆サイドのダンカーポケットへ。
function isoSpreadTarget(game: Game, p: Player, h: Player): { x: number; z: number } {
  const s = game.attackSign(h.team);
  const hz = s * RIM.z, dir = -s;
  const hs = h.pos.x >= 0 ? 1 : -1;            // スターが仕掛ける側
  if (game.isBig(p) && game.prefersPost(p)) {
    const bigs = game.teamPlayers(h.team)
      .filter((q) => q !== h && game.isBig(q) && game.prefersPost(q));
    return bigs.indexOf(p) <= 0
      ? { x: -hs * 4.9, z: hz + dir * 0.9 }
      : { x: hs * 6.7, z: hz + dir * 1.5 };     // ディープコーナー3
  }
  // ⚠️ 以前のディープウィングはリムから 9.2m / 9.7m ＝ 3Pラインの 2.5〜3m 外だった。
  //    そこに立っても守備は付いて来ず（サグしてヘルプに回る）、攻撃の役に立たない。
  //    釣り出しの目的＝守備を外へ連れ出す、はアーク上に立ってこそ成立する。
  const spots = [
    { x: -hs * 6.7, z: hz + dir * 1.5 },       // 逆コーナー(6.9m)
    { x: hs * 6.7, z: hz + dir * 1.5 },        // 強コーナー(6.9m)
    { x: -hs * 5.4, z: hz + dir * 4.6 },       // 逆ウィング(7.1m)
    { x: hs * 5.6, z: hz + dir * 4.4 },        // 強ウィング(7.1m)
  ];
  const mates = game.teamPlayers(h.team)
    .filter((q) => q !== h && !(game.isBig(q) && game.prefersPost(q)));
  const idx = Math.max(0, mates.indexOf(p));
  return spots[Math.min(idx, spots.length - 1)];
}

// オフボールの味方をハンドラーのドライブレーンから退かせる。処理したら true(フロントコートのみ)。
function clearDriveLane(game: Game, dt: number, p: Player): boolean {
  const h = game.handler;
  if (!h || !game.frontT) return false;
  const rim = game.attackFloor(h.team);
  const { ux, uz } = dirTo2D(h.pos.x, h.pos.z, rim.x, rim.z);   // ハンドラー→リム
  const rx = p.pos.x - h.pos.x, rz = p.pos.z - h.pos.z;
  const along = rx * ux + rz * uz;                 // ハンドラーの前方距離
  if (along < 0.3 || along > 5.5) return false;    // 後方 or 遠すぎ
  const perp = rx * -uz + rz * ux;                 // レーンからの符号付き横オフセット
  if (Math.abs(perp) > 1.25) return false;         // 既に走路外
  const side = Math.abs(perp) < 0.05 ? (p.pos.x >= 0 ? 1 : -1) : (perp > 0 ? 1 : -1);
  const tx = p.pos.x + -uz * side * 2.2, tz = p.pos.z + ux * side * 2.2;
  moveToward2D(p.pos, tx, tz, p.accelToward(dt, tx, tz, 1.15) * dt);
  p.spotIdx = bestOpenSpot(game, p.team, game.formationSpots(p.team), p);
  return true;
}

// p から (tx,tz) へのカットが、ステーションの味方(ポストビッグ1.7m/ハンドラー1.4m)を貫くか。
function cutLaneClear(game: Game, team: number, p: Player, tx: number, tz: number): boolean {
  const hits: { x: number; z: number; r: number }[] = [];
  for (const q of game.teamPlayers(team)) {
    if (q === p || q.cutting || q.screening) continue;
    if (q.spotIdx >= 5) hits.push({ x: q.pos.x, z: q.pos.z, r: 1.7 });
  }
  if (game.handler && game.handler !== p)
    hits.push({ x: game.handler.pos.x, z: game.handler.pos.z, r: 1.4 });
  const dx = tx - p.pos.x, dz = tz - p.pos.z;
  for (const o of hits) {
    // t を [0,1] にクランプした点までの距離で判定
    const t = clamp(segPerp(p.pos.x, p.pos.z, tx, tz, o.x, o.z).t, 0, 1);
    const px = p.pos.x + dx * t, pz = p.pos.z + dz * t;
    if (Math.hypot(o.x - px, o.z - pz) < o.r) return false;
  }
  return true;
}
