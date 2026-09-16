// スキーム選択: この停止/ポゼッションで守備が man / zone / press のどれを敷くかを決める。
import { chance, rate, clamp } from "../../../util";
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
