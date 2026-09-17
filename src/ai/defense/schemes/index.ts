// スキーム選択: この停止/ポゼッションで守備が man / zone / press のどれを敷くかを決める。
import { chance, rate, clamp, dist2D } from "../../../util";
import { DOUBLE_TEAM_PTS } from "../../../config";
import { TACTICS } from "../../../attributes";
import { scoringPower } from "../../../roles";
import { Player } from "../../../objects/player/player";
import type { Game } from "../../../game";

// この停止/ポゼッションで守備がどのスキームを敷くか(man/zone/press)を抽選して決める。
export function pickDefScheme(game: Game): void {
  const defTeam = 1 - game.possession;
  const tac = game.tactics[defTeam].defense;
  game.pressOn = chance(tac.press);
  // プレスもボールが上がれば man に落ちる。非プレスのみゾーンに commit。
  if (!game.pressOn && chance(tac.zone)) {
    const bigs = game.teamPlayers(defTeam).filter((p) => game.isBig(p));
    const tall = bigs.length ? bigs.reduce((s, p) => s + p.height, 0) / bigs.length : 2;
    // 高いフロントラインは 2-3、そうでなければ時々 3-2 でアークを守る
    game.zoneScheme = (tall > 2.02 || chance(0.6)) ? "2-3" : "3-2";
  } else {
    game.zoneScheme = "";
  }
}

/**
 * チームの守備の型を、各守備者の役割（マンマーク / ゾーン / ドロップ役）へ落とす。
 * ポゼッションごとに1回だけ走る。
 *
 * ⚠️ 手で指定した `defMode`（配置ボードの「ゾーン/マン」）は上書きしない。
 * ⚠️ 型を「センターはゾーン / ガードはマンマーク」と完全に分離すると、外に**ズレ**が
 *    生まれてフリーの3Pを打たれる。現代の守り方は融合型なので、既定の "drop" では
 *    **全員マンマークのまま、ビッグだけ外へ出ない**（＝ゴール下で待ち構える）形にする。
 */
export function applyDefScheme(game: Game, defTeam: number): void {
  const scheme = TACTICS[defTeam].scheme ?? "drop";
  const off = 1 - defTeam;
  const anchor = rimAnchorOf(game, defTeam);
  const ace = aceOf(game, off);
  const stopper = bestStopperOf(game, defTeam, ace);

  for (const d of game.teamPlayers(defTeam)) {
    d.dropBig = false;
    if (d.defModeUser) continue;                 // 手の指定が最優先
    if (scheme === "boxOne") {
      // ボックス・アンド・ワン: 1人がエースへ完全マンマーク、残り4人はゾーンで箱を作る
      if (d === stopper && ace) { d.defMode = "man"; d.markSlot = ace.slot; }
      else { d.defMode = "zone"; d.markSlot = undefined; }
    } else if (scheme === "matchup") {
      // マッチアップゾーン: 外はマンで圧、ビッグは自分のゾーンに入った相手だけ守る
      d.defMode = d === anchor ? "zone" : "man";
      d.markSlot = undefined;
    } else {
      // ドロップ: 全員マンマーク。ビッグだけ外へ出ずゴール下に留まる
      d.defMode = "man";
      d.markSlot = undefined;
      d.dropBig = d === anchor;
    }
  }

  // ⚠️ ゴール下の1対1を噛み合わせる。既定の index 一致だと、守備のリムアンカー
  //    （身長×ブロック力で選ぶ）と、攻撃のポストアンカー（3Pが最も低いビッグ）の
  //    **スロットが一致しない**。その結果ゴール下で相手ビッグを誰も見ておらず、
  //    実測で「ポストの相手の最寄りが守備のドロップ役だった」のは 31.8% しか無かった。
  //    アンカー同士を当て、玉突きで空く枠は相手の元の担当と交換して1対1を保つ。
  if (scheme !== "boxOne" && anchor && !anchor.defModeUser) {
    const oppPost = game.postAnchor(off);
    if (oppPost) {
      const mine = anchor.markSlot ?? anchor.slot;
      const want = oppPost.slot;
      if (mine !== want) {
        for (const q of game.teamPlayers(defTeam)) {
          if (q === anchor || q.defModeUser) continue;
          if ((q.markSlot ?? q.slot) === want) { q.markSlot = mine; break; }
        }
        anchor.markSlot = want;
      }
    }
  }

  // ⚠️ 担当（markSlot）が確定してから決める。2人目は「担当が3Pを打てない守備者」を
  //    選ぶので、上の入れ替えより先に決めると古い担当で選んでしまう。
  pickDoubleTeam(game, defTeam);
}

/**
 * ゴール下で量産されている相手を、ダブルチームで抑えるか決める。
 * ⚠️ 1人で抑え切れているうちは行かない。ダブルに行けば必ずどこかが空くので、
 *    **実際に決められた点数**（rimPts）を根拠にする。
 * ⚠️ 2人目は「自分の担当が3Pを最も打てない守備者」から選ぶ。ダブルで空くのは
 *    その担当なので、空けて一番痛くない相手を空ける。
 */
function pickDoubleTeam(game: Game, defTeam: number): void {
  game.doubleTarget = null;
  game.doubler = null;
  const off = 1 - defTeam;
  let worst: Player | null = null;
  for (const p of game.teamPlayers(off)) {
    if (p.rimPts < DOUBLE_TEAM_PTS) continue;
    if (!worst || p.rimPts > worst.rimPts) worst = p;
  }
  if (!worst) return;
  const anchor = rimAnchorOf(game, defTeam);
  let best: Player | null = null, bv = -Infinity;
  for (const d of game.teamPlayers(defTeam)) {
    if (d === anchor || d.defModeUser) continue;         // リムアンカーは1人目なので残す
    const mine = game.teamPlayers(off)[d.markSlot ?? d.slot];
    // 担当の3Pが低いほど、そして相手ポストに近いほど寄せやすい
    const v = (mine ? 1 - rate(mine.attr.threeAcc) : 0.5) * 1.6
      - dist2D(d.pos, worst.pos) * 0.12;
    if (v > bv) { bv = v; best = d; }
  }
  if (!best) return;
  game.doubleTarget = worst;
  game.doubler = best;
}

/** リムを守る1人（ビッグのうち、身長＋ブロック力が最も高い者）。 */
function rimAnchorOf(game: Game, team: number): Player | null {
  let best: Player | null = null, bv = -Infinity;
  for (const p of game.teamPlayers(team)) {
    if (!game.isBig(p)) continue;
    const v = (p.height - 1.9) * 2 + rate(p.attr.jump) * 0.6 + rate(p.attr.defense) * 0.6;
    if (v > bv) { bv = v; best = p; }
  }
  return best;
}
/** 相手の最大脅威（得点力＋身長）。 */
function aceOf(game: Game, team: number): Player | null {
  let best: Player | null = null, bv = -Infinity;
  for (const p of game.teamPlayers(team)) {
    const v = scoringPower(p.attr) / 100 + (p.height - 1.9) * 0.25;
    if (v > bv) { bv = v; best = p; }
  }
  return best;
}
/** エースを止めに行かせる1人（守判断・敏捷・身長差）。 */
function bestStopperOf(game: Game, team: number, ace: Player | null): Player | null {
  let best: Player | null = null, bv = -Infinity;
  for (const p of game.teamPlayers(team)) {
    const fit = rate(p.attr.defense) * 0.5 + rate(p.attr.agility) * 0.3
      + (ace ? clamp(1 - Math.abs(p.height - ace.height) * 4, 0, 1) * 0.2 : 0);
    if (fit > bv) { bv = fit; best = p; }
  }
  return best;
}
