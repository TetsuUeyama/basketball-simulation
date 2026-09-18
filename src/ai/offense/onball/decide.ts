// ハンドラーの判断tick。シュート/ドライブ/パス/リセットを、状況(クロック・守備)と
// オフェンスロール・個人の傾向・チーム戦術から選ぶ。実行は ./drive ./keep 側。

/**
 * 突破を仕掛けてよいかの門番。
 *  lo/hi … ドリブル技量をこの範囲で 0..1 に正規化（DBの実分布は概ね 0.60〜0.95）
 *  spd   … 走速のこの割合を超えていれば「スピードに乗っている」
 *  edge  … 相手守備との差がこれだけあれば「明確に格下」
 *  floor … どれも満たさない時に残す意欲の割合
 */
const DRIVE_GATE = { lo: 0.72, hi: 0.88, spd: 0.5, edge: 0.15, floor: 0.35 };

/**
 * 3Pラインの手前で打とうとした時に「一歩下がる」条件。
 *  near  … リムからこれ以上なら、下がれば3Pになる距離とみなす
 *  space … 守備がこれだけ離れていること（詰められていたら下がる余裕がない）
 *  acc   … 3Pを打つ価値のある精度
 */
const ARC_STEP = { near: 5.9, space: 1.6, acc: 0.68 };

/** 3Pの価値（2Pの1.5倍）を撃つ判断へ反映させる係数。射手の精度に比例して効く。 */
const THREE_VALUE = 0.55;
/**
 * ジャンパーを撃つ資格。この距離帯のシュート精度を 0..1 に正規化し、
 * 低い選手ほど pShoot を floor 倍まで削る。
 * ⚠️ ミドルには**精度の項がまったく無かった**（pShoot は攻撃性・オフェンス順位・
 *    チームのペースだけで決まっていた）。精度50のビッグも精度90のガードも同じ
 *    確率でミドルを打っていた。打てない選手はゴール下を狙い、ジャンパーは
 *    「仕方なく」打つ形にする。
 * ⚠️ クロックに追われた分(push)には掛けない。残り時間が無ければ下手でも打つ＝
 *    それが「仕方なく」。
 */
const SHOOTER_GATE = { lo: 0.62, hi: 0.85, floor: 0.25 };
/**
 * 3Pラインより外へ下がって打つことへの罰。
 *   pen  … 超過1mあたりの減点
 *   ease … 射程(L速度)が長い選手をどれだけ緩めるか（1.0で射程100なら罰ゼロ）
 */
const DEEP_THREE = { pen: 0.22, ease: 0.5 };
/** 打てない選手が、リムの近く(この距離内)に居る時どれだけリムへ向かうか。 */
const RIM_PREF = { range: 5.0, gain: 0.35 };
import { Vector3 } from "@babylonjs/core";
import { Player } from "../../../objects/player/player";
import { THREE_DIST, SHOT_CLOCK, BUZZER_WINDOW } from "../../../config";
import { rate, clamp, chance, rand, dist2D, dirTo2D } from "../../../util";
import { twWeight, gatherFor, effShootRange, wontLoadUp, leapHeight } from "../../../eval";
import { pass, passToReceiver } from "../../../move/action/passing";
import { shoot, finishAtRim, tryShotFake } from "../../../move/action/shooting";
import { denySmother } from "../../defense/shared";
import { doubleTeamApproaching, betterOptionAvailable, laneClear } from "../reads";
import { canIso, postMove, pushBreak, driveDecision, stepBack, stepBehindArc } from "./drive";
import { driveKicker } from "../../../eval";
import {
  mustKeepDribble, keepDribbleDecide, trapKickOut, retreatFromTrap,
  bringUpLane, outletTo, advanceSafely,
} from "./keep";
import type { Game } from "../../../game";

// ダブルチーム記憶: 直近でトラップに遭った選手を no-feed 対象に保つ秒数
const TRAP_MEMORY = 2.5;

// クロック逼迫度: ショットクロックが SHOT_CLOCK*frac を切ってからの経過割合(0..1)。
function clockPush(game: Game, frac: number): number {
  const w = SHOT_CLOCK * frac;
  return clamp((w - game.shotClock) / w, 0, 1);
}

  // ボールハンドラーの選択 — シュート/ドライブ/パス/リセット — 選手自身の
  // 傾向とスキルを、チームの戦術的ゲームプランと融合させる。
/** 背の高い守備者の圧を見る距離(m)。 */
/** ヘルプが寄っている時、ドライブから配りへ抜ける1tickあたりの確率係数。 */
const KICK_OUT = 0.55;
const TALL_PRESS_RANGE = 2.2;
/** 圧を受けたときシュート意欲をどれだけ削るか。 */
const TALL_PRESS_SHOOT = 0.55;
/** 同じくドライブ意欲をどれだけ足すか。 */
const TALL_PRESS_DRIVE = 0.45;
export function decide(game: Game, h: Player, dHoop: number, dDef: number, rimFloor: Vector3): void {
    // シュートフェイク。⚠️ ここを唯一の入口にする（打つ判断は全部この2つを通す）。
    // 仕掛けたフレームは打たずに持ち、fakeT が切れた次のフレームに fakeGo で本番へ。
    const goShoot = (): void => {
      if (!h.fakeGo && tryShotFake(game, h, false)) return;
      h.fakeGo = false;
      shoot(game, h, dHoop, dDef);
    };
    const goFinish = (): void => {
      if (!h.fakeGo && tryShotFake(game, h, true)) return;
      h.fakeGo = false;
      finishAtRim(game, h, dDef);
    };
    // フェイク中は持つ（ドライブもパスもしない）。切れたら本番のシュートへ。
    if (h.fakeT > 0) return;
    if (h.fakeGo) { if (h.fakeFinish) goFinish(); else goShoot(); return; }
    const tac = game.tactics[h.team].offense;
    const prio = h.offPriority;
    // ロール由来の行動プロファイル: 何をするかはオフェンスロールが支配する。
    // canCreate = 自分から仕掛ける役（エース/スラッシャー/得点ビッグ/balanced）、
    // passFirst = まず配球（ハンドラー/フロアジェネラル/ハブビッグ）、
    // noCreate = 無理に作らない（スポット/カッター/スクリーナー/リバウンダー等）。
    const act = h.offAction;
    const canCreate = act === "score" || act === "slash" || act === "postScore" || act === "balanced";
    const passFirst = act === "distribute" || act === "postHub";
    const noCreate = act === "spot" || act === "cut" || act === "run" || act === "screen" || act === "rebound";

    // ブザービーター: ゲーム/ショットクロックがほぼ無い — どこからでも放り上げる。
    // ゲームブザー → 常に放る。ショットクロックブザー → 強い deny に覆われて
    // いない限り放る。
    const gameBuzzer = game.gameClock > 0 && game.gameClock < BUZZER_WINDOW;
    const shotBuzzer = game.shotClock < 0.45;
    // 深い一発はギャザーするクロックが残っている時のみ放てる。
    // (クォーター終わりのゲームブザーは対象外。)
    const canGather = game.shotClock >= gatherFor(h, dHoop);
    if ((gameBuzzer || (shotBuzzer && canGather && !denySmother(game, h, dDef))) && dHoop > 1.8) {
      shoot(game, h, dHoop, dDef); return;   // ブザー: フェイクしている時間が無い
    }

    // ゴール至近でフリーで受けた: 迷わずフィニッシュ。
    if (dDef > 1.0 && game.frontT) {
      if (dHoop <= 2.3) { goFinish(); return; }
      if (dHoop <= 4.0 && laneClear(game, h, rimFloor)) { game.setDrive(h, rimFloor, 1.2); return; }
    }

    // 運び上げはガードの仕事: フロントコート確立前にボールを持ったビッグは
    // PG→SG を探して渡す。プレイメイキングビッグは対象外(自分で運ぶ)。
    if (!game.frontT && game.isBig(h) && h.evalRole !== "プレイメイキングビッグ" && dHoop > 10) {
      // 最良のプレイメイカー2人が候補
      const guards = game.teamPlayers(h.team).filter((g) => g !== h)
        .sort((a, b) => b.playmaking - a.playmaking);
      for (const g of guards.slice(0, 2)) {
        if (outletTo(game, h, g)) return;
      }
      advanceSafely(game, h);                     // まだフリーのガード無し — 保持/流す
      return;
    }

    // 速攻: 守備が整う前にリムへ強く押し込む(ビッグは上でアウトレット済み)。
    if (game.pushT > 0) { pushBreak(game, h, dHoop); return; }

    // リム際 → フィニッシュ。全力バーストで到達したハンドラーは早めに踏み切る。
    if (dHoop < (h.beatenT > 0 ? 2.3 : 1.8)) { goFinish(); return; }

    // 形成中のダブルチーム → 早めに手放す。ハンドル(D精度)が悪いほど早く手放す。
    // (既に仕掛けた move は続行。安全なアウトレットが無ければ下へ抜ける。)
    const committing = h.beatenT > 0 || h.powerT > 0 || h.jukeT > 0;
    if (!committing && game.shotClock > 1 && doubleTeamApproaching(game, h)) {
      const bail = clamp(0.15 + (1 - rate(h.attr.dribbleAcc)) * 1.0
        + (1 - rate(h.attr.handling)) * 0.15, 0.12, 0.96);
      if (chance(bail) && pass(game, h)) return;
    }

    // 低 D精度、マークされている: キープしかできない(渡す/じりじり前進/保持)。
    if (mustKeepDribble(game, h, dDef)) { keepDribbleDecide(game, h, dHoop, dDef, rimFloor); return; }

    // ドライブ&キック: 仕掛けは最後まで見届けるのが原則だが、**ヘルプが寄った瞬間だけ**
    // は配れる選手に抜け道を作る。引きつけて空いた味方へラストパスを出すのが、
    // ドリブルもパスも高い選手（C・ロナウド型）の一番の活かし方。
    // ⚠️ 誰にでも許すと「仕掛けたのにすぐ手放す」になるので、driveKicker が高い選手だけ。
    // ⚠️ ヘルプが来ていない時は配らない（引きつけていないのにキックしても意味が無い）。
    if (h.beatenT > 0 || h.powerT > 0 || h.jukeT > 0) {
      const kick = driveKicker(h);
      if (kick > 0 && game.defendersWithin(h, 2.4) >= 2 && game.shotClock > 1
          && chance(kick * KICK_OUT) && pass(game, h)) return;
      return;
    }
    // 壁で止められた: より良い形へキックアウト、さもなければ引き戻して再アタック。
    if (h.stalledT > 0) { if (chance(0.5) && pass(game, h)) return; return; }

    // コンボ途中: 逆方向の次の move ですぐデュエルへ戻る
    if (h.comboN > 0) {
      if (canIso(game, h, dHoop)) { driveDecision(game, h); return; }
      h.comboN = 0;                        // コンボを打ち切る
    }

    // 担当守備者が足を離した(ギャンブル/食いついたフェイク) → ボールを床に置いて抜く。
    // (突くのはショットクリエイターだけ。)
    if (canCreate) {
      const od = game.onBallDefender(h);
      if (od && od.airborne && dDef < 2.2 && canIso(game, h, dHoop)
          && chance(0.45 + rate(h.attr.reaction) * 0.3 + rate(h.attr.handling) * 0.15)) {
        h.driveSide = game.pickSide(h);
        h.beatenT = rand(0.6, 0.9);
        od.applyReactLag();
        game.setDriveSide(h);
        return;
      }
      // クローズアウトを攻める: 勢いよく飛び込んでくる守備者は真っ直ぐ抜き去れる。
      if (od && !od.airborne && dDef < 2.4 && od.curSpd > od.runSpeed * 0.55
          && canIso(game, h, dHoop)) {
        const edge = rate(h.attr.handling) * 0.4 + rate(h.attr.agility) * 0.35
          + rate(h.attr.dribbleAcc) * 0.25 - rate(od.attr.balance) * 0.5;
        if (chance(clamp(0.3 + edge, 0.08, 0.75))) {
          h.driveSide = game.pickSide(h);
          h.beatenT = rand(0.55, 0.85);
          od.applyReactLag();
          game.setDriveSide(h);
          return;
        }
      }
    }

    // 目の前の守備を抜けない: 単騎の壁でもキックアウトで打開を試みる
    if (h.stalledT > 0 && dDef < 1.6 && trapKickOut(game, h)) return;

    // ダブルチーム/トラップ: 2人とも密着した本物のトラップ時のみ読みが引き継ぐ。
    // 正しい読みはキックアウトか保持してリセット。
    {
      const d1 = game.onBallDefender(h);
      let tight = 0, contain = 0;
      let d2: Player | null = null, d2d = Infinity;
      for (const dn of game.teamPlayers(1 - h.team)) {
        const dd = dist2D(dn.pos, h.pos);
        if (dd < 1.6) {
          tight++;
          contain += rate(dn.attr.defense) * 0.4 + rate(dn.attr.agility) * 0.35 + rate(dn.attr.balance) * 0.25;
        }
        if (dn !== d1 && dd < 1.9 && dd < d2d) { d2d = dd; d2 = dn; }
      }
      // トラップを人に紐づけて記憶する(A→B→A のラリーを潰す)
      if (tight >= 2) h.trappedT = TRAP_MEMORY;
      // 本物のトラップ: 1.6m以内に2人、かつ実際のオンボール圧(dDef が密着)
      if (tight >= 2 && dDef < 1.4) {
        // ドリブルからトラップを割る。指定スラッシャー(能力"driver" / offAction"slash")
        // は進んで行い、それ以外は稀。2人の隙間と味方のスクリーンで開き、
        // 成功はトラップに対して相対的。
        if (canIso(game, h, dHoop)) {
          // リムへのレーンに沿って測る隙間: 両側に割れている → 真ん中に隙間、
          // 一方に偏っている → 外側が開き口、ボールに重なっている → レーン無し。
          let seam = 0;
          if (d1 && d2) {
            const { ux, uz } = dirTo2D(h.pos.x, h.pos.z, rimFloor.x, rimFloor.z);
            const px = -uz, pz = ux;                                    // 横軸
            const lat1 = (d1.pos.x - h.pos.x) * px + (d1.pos.z - h.pos.z) * pz;
            const lat2 = (d2.pos.x - h.pos.x) * px + (d2.pos.z - h.pos.z) * pz;
            seam = lat1 * lat2 < 0 ? Math.min(Math.abs(lat1), Math.abs(lat2)) : 0.8;
          }
          const seamScore = clamp((seam - 0.4) / 1.2, 0, 1);           // 密着..完全にオープン
          // 味方がトラッパーにスクリーンすると彼を釘付けにし、トラップが人手不足になる
          let screen = 0;
          for (const mate of game.teamPlayers(h.team)) {
            if (mate === h) continue;
            if (d1 && dist2D(mate.pos, d1.pos) < 1.2) screen = Math.max(screen, 0.5);
            if (d2 && dist2D(mate.pos, d2.pos) < 1.2) screen = Math.max(screen, 0.5);
          }
          const attack = rate(h.attr.handling) * 0.35 + rate(h.attr.agility) * 0.35
            + rate(h.attr.dribbleAcc) * 0.20 + rate(h.attr.speed) * 0.10;
          const rel = attack - contain / tight;                        // トラップに対する優位
          const slasher = h.has("driver") || act === "slash";
          const openness = seamScore * (slasher ? 0.28 : 0.14) + screen * (slasher ? 0.22 : 0.12);
          const splitChance = slasher
            ? clamp(0.05 + rel * 1.5 + openness, 0.03, 0.65)
            : clamp(0.02 + rel * 0.45 + openness, 0.015, 0.24);
          if (chance(splitChance)) { driveDecision(game, h); return; }
        }
        // 割れない → パスで解決: トラップが空けた選手へキックアウト。誰も空いて
        // いなければリトリートドリブルでトラップから抜けてリセット。
        if (trapKickOut(game, h)) return;
        retreatFromTrap(game, h);
        return;
      }
    }

    // ロール駆動の行動 — 今何をするかはオフェンスロールに従う。
    if (passFirst) {
      // ハンドラー/フロアジェネラル/ハブビッグ: まず配球。空いた球は打ち、
      // レーンが開けば仕掛ける。
      if (!game.frontT) { bringUpLane(game, h); return; }
      if (game.shotClock < SHOT_CLOCK * 0.3 && dHoop > 1.8 && canGather && !wontLoadUp(h, dHoop, dDef) && !denySmother(game, h, dDef)) {
        // 投げ捨てる前に: 1秒以上あるなら深い3を避けてラインへ寄る。
        if (dHoop > effShootRange(h) + 0.6 && game.shotClock > 1.0) { game.setDrive(h, rimFloor, THREE_DIST + 0.2); return; }
        goShoot();
        return;
      }
      const inRange = dHoop <= effShootRange(h) + 0.3;
      const push = clockPush(game, 0.5);   // 遅いほど打つ(残半分から)
      // 綺麗なレーン → 守備を歪ませに攻める(ビッグはドリブルでなくポスト)
      if (laneClear(game, h, rimFloor) && dHoop <= 8 && canIso(game, h, dHoop)
          && chance(clamp(0.2 + rate(h.attr.handling) * 0.25 + push * 0.3, 0, 0.6))) {
        if (game.isBig(h)) postMove(game, h); else driveDecision(game, h);
        return;
      }
      const open = dDef > 1.7;
      const pS = clamp(0.16 + rate(h.attr.threeAcc) * 0.28 + (dDef - 1.7) * 0.2 + push * 0.5, 0.04, 0.9);
      if (inRange && open && chance(pS)) { goShoot(); return; }
      if (pass(game, h)) return;
      game.setDrive(h, rimFloor, Math.min(4.5, Math.max(dHoop, 1.2)));   // 探り/リセット — 選手をペイントの外へ後退させない
      return;
    }
    if (noCreate) {
      // スポット/カッター/ランナー/スクリーナー/リバウンダー: キャッチ&シュートが
      // 基本。クローズアウトには仕掛け、開いた球は打つ。
      if (!game.frontT) { bringUpLane(game, h); return; }
      if (game.shotClock < SHOT_CLOCK * 0.3 && dHoop > 1.8 && canGather && !wontLoadUp(h, dHoop, dDef) && !denySmother(game, h, dDef)) {
        // 投げ捨てる前に: 1秒以上あるなら深い3を避けてラインへ寄る。
        if (dHoop > effShootRange(h) + 0.6 && game.shotClock > 1.0) { game.setDrive(h, rimFloor, THREE_DIST + 0.2); return; }
        goShoot();
        return;
      }
      const inRange = dHoop <= effShootRange(h) + 0.3;
      const push = clockPush(game, 0.5);
      // クローズアウトを攻める: ハンドルを持つシューターは飛び込む守備者を抜き去る。
      const od = game.onBallDefender(h);
      if (od && !od.airborne && dDef < 2.3 && od.curSpd > od.runSpeed * 0.5
          && canIso(game, h, dHoop) && rate(h.attr.handling) > 0.45
          && chance(clamp(0.28 + rate(h.attr.handling) * 0.4 + rate(h.attr.agility) * 0.3
              - rate(od.attr.balance) * 0.4, 0.1, 0.7))) {
        h.driveSide = game.pickSide(h); h.beatenT = rand(0.5, 0.8);
        od.applyReactLag();
        game.setDriveSide(h); return;
      }
      const isThreeL = dHoop > THREE_DIST;
      const open = dDef > (h.has("isoShooter") ? 1.3 : 1.5);
      const pS = clamp(0.42 + rate(h.attr.aggression) * 0.2 + (dDef - 1.5) * 0.22
        + (isThreeL ? tac.threeBias * 0.2 * twWeight(h) : 0.12) + push * 0.4, 0.06, 0.95);
      if (inRange && open && chance(pS)) { goShoot(); return; }
      if (pass(game, h)) return;
      game.setDrive(h, rimFloor, Math.min(4.5, Math.max(dHoop, 1.2)));
      return;
    }

    // ビッグ/ポスト能力者はポストで勝負: 守備者をリムまで押し込む。
    // 強くボディアップ or 良い形が空けばキックアウト。
    if (game.isBig(h) || h.has("post")) {
      if (dDef < 1.1 && chance(0.3)) {
        const better = betterOptionAvailable(game, h);
        if (better && passToReceiver(game, h, better)) return;
      }
      if (dHoop > 6 && chance(dHoop > 10 ? 0.85 : 0.45) && pass(game, h)) return;
      postMove(game, h);
      return;
    }

    // 残クロックに対する相対しきい値(SHOT_CLOCK 依存)で「打ち急ぎ」に入る。
    const urgent = game.shotClock < SHOT_CLOCK * (0.42 + tac.pace * 0.14 * twWeight(h));
    // 打ち急ぎ圏でギャザーが間に合わない → レイアップを狙ってリムへ切り込む
    if (urgent && game.shotClock > 0.8 && wontLoadUp(h, dHoop, dDef)) {
      driveDecision(game, h);
      return;
    }
    if (urgent && canGather && !wontLoadUp(h, dHoop, dDef) && !denySmother(game, h, dDef)) {
      // 打ち急ぎでも深い3は投げ捨てない: 1秒以上あればラインへ寄る。
      if (dHoop > effShootRange(h) + 0.6 && game.shotClock > 1.0) { game.setDrive(h, rimFloor, THREE_DIST + 0.2); return; }
      goShoot();
      return;
    }

    // 各行動をしたい度合い = 性格 + スキル + 戦術(×連携) + 得点ロール
    // + 特殊能力 (ドリブラー/ストライカー/ドリブルキープ)
    const tw = twWeight(h);
    let driveDesire = rate(h.attr.aggression) * 0.35 + rate(h.attr.handling) * 0.25 + tac.driveBias * 0.4 * tw;
    if (h.has("driver")) driveDesire += 0.25;        // ドリブラー: 抜き去りを狙う
    // ⚠️ ドリブルが下手な選手ほど突破を控え、キープを優先する。
    //    以前は handling の重みが 0.25 しかなく、実測でドライブ挑戦率が
    //    ハンドリング 60〜70 / 70〜80 / 80〜101 で 2.2 / 2.5 / 2.5（1000フレーム比）と
    //    **ほぼ横並び**だった。その結果、下手な選手が突っかけて失う。
    //    ただし次のどれかが立てば従来どおり仕掛けてよい:
    //      ①元々ドリブルが巧い ②既にスピードに乗っている ③相手が明確に格下
    {
      const hand = rate(h.attr.handling) * 0.6 + rate(h.attr.dribbleAcc) * 0.4;
      const skill = clamp((hand - DRIVE_GATE.lo) / (DRIVE_GATE.hi - DRIVE_GATE.lo), 0, 1);
      const atSpeed = clamp((h.curSpd - h.runSpeed * DRIVE_GATE.spd) / (h.runSpeed * 0.3), 0, 1);
      const cd0 = game.nearestDefender(h);
      const edge = cd0 ? clamp((hand - rate(cd0.attr.defense)) / DRIVE_GATE.edge, 0, 1) : 0.5;
      const gate = Math.max(skill, atSpeed, edge);
      driveDesire *= DRIVE_GATE.floor + gate * (1 - DRIVE_GATE.floor);
    }
    let shootDesire = rate(h.attr.aggression) * 0.4 + prio * 0.4 + tac.pace * 0.2 * tw;
    if (h.has("striker")) shootDesire += 0.15;       // ストライカー: スコアラーの心構え
    if (h.has("keepDribble")) shootDesire -= 0.08;   // キープ型は攻め急がない
    let passDesire = (1 - rate(h.attr.aggression)) * 0.25 + rate(h.attr.passAcc) * 0.2
      + tac.ballMovement * 0.4 * tw + (1 - prio) * 0.25; // 優先度が低い者ほど手放す

    // ペイント内: 連携が低い選手ほど「自分で決める」を優先 — ドライブ/フィニッシュ
    // 意欲を上げ、キックアウト意欲を下げる。
    if (dHoop <= 4.3 && Math.abs(h.pos.x) <= 2.6) {
      const selfish = (1 - rate(h.attr.teamwork)) * 0.4;   // 連携100→+0, 連携0→+0.4
      driveDesire += selfish;
      shootDesire += selfish;
      passDesire = Math.max(0, passDesire - selfish * 1.2);
    }

    // 背の高い（跳んで高く届く）守備者に近くで構えられている選手は、シュートを
    // やめて仕掛ける方へ寄る。⚠️ 身長そのものではなく**跳んで届く高さの差**で見る。
    // 低身長の選手ほどここが大きくなり、シュートを打たずドライブを選びやすくなる。
    {
      const cd = game.nearestDefender(h);
      if (cd && dDef < TALL_PRESS_RANGE) {
        const over = (cd.height * 1.35 + leapHeight(cd))
          - (h.height * 1.35 + leapHeight(h) * 0.55);
        const press = clamp(over, 0, 0.6) * clamp(1 - (dDef - 0.8) / (TALL_PRESS_RANGE - 0.8), 0, 1);
        shootDesire -= press * TALL_PRESS_SHOOT;
        driveDesire += press * TALL_PRESS_DRIVE;
      }
    }

    // 打てない選手は、近い位置ならジャンパーではなくリムへ持ち込む。
    // ⚠️ 遠い位置では上げない。ハンドリングの低い選手をペリメーターから突っ込ませると
    //    ターンオーバーが増えるだけ（DRIVE_GATE で既に抑えている理由と同じ）。
    const jumpAcc = Math.max(rate(h.attr.midAcc), rate(h.attr.threeAcc));
    const shooterGate = SHOOTER_GATE.floor
      + clamp((jumpAcc - SHOOTER_GATE.lo) / (SHOOTER_GATE.hi - SHOOTER_GATE.lo), 0, 1)
        * (1 - SHOOTER_GATE.floor);
    if (dHoop <= RIM_PREF.range) driveDesire += (1 - shooterGate) * RIM_PREF.gain;

    const laneOpen = laneClear(game, h, rimFloor);
    const beaten = h.beatenT > 0;
    const isThree = dHoop > THREE_DIST;

    // 射程内でリムへの道が開けている → 通常は攻める。ただしキック or
    // エリートシューターの完全オープンは除く。
    if ((beaten || laneOpen) && dHoop <= 9) {
      if (!beaten && isThree && dDef > 2.0 && rate(h.attr.threeAcc) > 0.65
          && dHoop <= effShootRange(h) + 0.3           // 効き射程内(深い3はエリートのみ)
          && chance(0.25 + tac.threeBias * 0.4 * tw)) { goShoot(); return; }
      const driveChance = beaten ? 1 : clamp(0.35 + driveDesire * 0.55, 0.25, 0.95);
      if (chance(driveChance)) { driveDecision(game, h); return; }
      if (chance(passDesire * 0.7) && pass(game, h)) return;
      driveDecision(game, h);
      return;
    }

    // 綺麗なレーン無し: オープンな形は打ち、難しい形はより高い得点オプションへ回す。
    if (dHoop <= effShootRange(h) + 0.3) {
      // 1対1シュート: 単独の守備者の上からなら喜んで打つ
      const open = dDef > (h.has("isoShooter") ? 1.4 : 1.7);
      // クロック連動の撃ち急ぎ: 残クロックが減るほどオープンな射程内の球は打つ。
      const push = clockPush(game, 0.6);
      // ⚠️ 3Pは2Pの1.5倍の価値がある。以前は距離の罰 -(dHoop-2)*0.04 が 7m で -0.20 効き、
      //    さらに 3P には -0.05 の下駄まで乗って**実質マイナス**だった。その結果
      //    3Pの試投が全体の 13% ほどしか出ていなかった（実際のNBAは約39%）。
      //    距離の罰はラインまでで頭打ちにし、3Pには射手の精度に応じた加点を与える。
      const dPen = Math.min(dHoop, THREE_DIST) - 2;
      // ⚠️ 上の `Math.min` でラインより外の距離が切り捨てられるため、**「ラインの1m外」と
      //    「3m外」が打つ判断としてまったく同じ魅力**になっていた。その結果、実測で3Pの
      //    119本中80本が正面から**ラインの 2.49m 外**、成功率 18〜27% という深い放り投げに
      //    なっていた（コーナーの近い3Pは 66.7% 決まっているのに、そちらは撃たない）。
      //    射程(L速度)は「打てる限界」であって「そこから打つべき距離」ではない。
      //    ラインを超えた分に改めて罰を掛ける。射程の長い選手ほど緩くする。
      const deepPen = Math.max(0, dHoop - THREE_DIST) * DEEP_THREE.pen
        * (1 - rate(h.attr.threeRange) * DEEP_THREE.ease);
      // ⚠️ この距離帯のシュート精度で意欲を削る。3Pは threeAcc、ミドルは midAcc。
      //    クロックに追われた分(push)だけは削らない＝下手でも仕方なく打つ。
      const gate = SHOOTER_GATE.floor
        + clamp(((isThree ? rate(h.attr.threeAcc) : rate(h.attr.midAcc)) - SHOOTER_GATE.lo)
                / (SHOOTER_GATE.hi - SHOOTER_GATE.lo), 0, 1) * (1 - SHOOTER_GATE.floor);
      let pShoot = (0.20 + shootDesire * 0.55 - dPen * 0.04 - deepPen + (dDef - 1) * 0.3) * gate + push * 0.5;
      if (isThree) pShoot += tac.threeBias * 0.22 * tw + (rate(h.attr.threeAcc) - 0.55) * THREE_VALUE;
      pShoot = clamp(pShoot, 0.03, 0.96);
      if (open && chance(pShoot)) {
        // ⚠️ ラインの**手前**で構えていて、下がれば3Pになるなら一歩退がる。
        //    実測でシュートが 6.0〜6.75m に固まり、3Pの試投が全体の 9.4% しか無かった。
        //    条件: オープンで、3Pを狙う価値がある射手で、足が止まっていないこと。
        if (!isThree && dHoop > ARC_STEP.near && dDef > ARC_STEP.space
            && rate(h.attr.threeAcc) > ARC_STEP.acc && h.jukeT <= 0 && h.coolT <= 0) {
          stepBehindArc(game, h);
          return;
        }
        goShoot(); return;
      }

      // クローズアウトしてくる守備者をステップバックで罰する: 抜き去るか綺麗な空間で打つ
      if (!open && dDef < 1.5 && canIso(game, h, dHoop) && h.jukeT <= 0
          && (rate(h.attr.midAcc) > 0.55 || rate(h.attr.threeAcc) > 0.6)
          && chance(clamp(0.05 + rate(h.attr.dribbleAcc) * 0.14 + rate(h.attr.agility) * 0.1, 0, 0.32))) {
        const d = game.onBallDefender(h);
        if (d) { stepBack(game, h, d, dHoop); return; }
      }

      // 綺麗な形でない → スコアラーはドリブルから攻める(本物のアイソ)。
      if (canIso(game, h, dHoop) && chance(clamp(0.2 + driveDesire * 0.5, 0.08, 0.7))) {
        driveDecision(game, h); return;
      }

      // 難しいシュート → より良い(オープンな)得点オプションへ回すことを探す
      const better = betterOptionAvailable(game, h);
      if (better && passToReceiver(game, h, better)) return;

      if (chance(pShoot)) { goShoot(); return; } // でなければ自分を信じて打つ
    }
    // 射程外(または打つのを見送った): ドリブルから攻める、さもなければ動かす、
    // さもなければ探ってリセット。クロックが減るとドライブ欲が上がる。
    const clockCommit = clockPush(game, 0.6); // 序盤0 .. 終盤1
    if (canIso(game, h, dHoop) && chance(clamp(driveDesire * 0.45 + clockCommit * 0.75, 0, 0.95))) {
      driveDecision(game, h); return;
    }
    const passUrge = clamp((passDesire * 0.6 + (dDef < 1.3 ? 0.2 : 0)) * (1 - clockCommit * 0.85), 0, 0.85);
    if (chance(passUrge) && pass(game, h)) return;
    // クロックが逃げているのにまだ仕掛けていない → リセットをやめて行く
    if (game.shotClock < SHOT_CLOCK * 0.5 && canIso(game, h, dHoop)) { driveDecision(game, h); return; }
    // まだ運び上げ中 → サイドのレーンを運ぶ。フロントコートではリセットの探り。
    if (!game.frontT) bringUpLane(game, h);
    else game.setDrive(h, rimFloor, Math.min(4.5, Math.max(dHoop, 1.2)));
  }
