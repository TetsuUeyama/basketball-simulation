// オフボールの立ち位置: フォーメーションスポットの選定(bestOpenSpot)と、味方/ボール
import { Vector3 } from "@babylonjs/core";
import { Player } from "../../../objects/player/player";
import { LANE_W, THREE_DIST } from "../../../config";
import { clamp, dist2D, dist2DTo, moveToward2D, segPerp } from "../../../util";
import type { Game } from "../../../game";
import { arcCap } from "../reads";
import { deepThreeOK } from "../../../eval";

// 間合いを保とうとしている最寄りの味方(ハンドラー/カッター/スクリーナーは除く)。
export function nearestTeammateDist(game: Game, self: Player): number {
  let best = Infinity;
  for (const q of game.teamPlayers(self.team)) {
    if (q === self || q === game.handler || q.cutting || q.screening) continue;
    best = Math.min(best, dist2D(self.pos, q.pos));
  }
  return best;
}

// オフボール選手を味方のパーソナルスペースから押し出し、毎フレーム間合いを保つ(boids風分離)。
/**
 * 押し出し（スペーシング）の**向き**から「アークの外へ出る成分」だけを抜く。
 * ⚠️ 位置を書き換えて引き戻してはいけない（ワープになる）。選手は必ず自分の足で
 *    （accelSpeed の刻みで）動くこと。ここでやるのは「どちらへ寄るか」の判断だけで、
 *    行けない場所を作るのではない。外へ出たいなら出られる。
 * ⚠️ オフェンスの基準線は 3Pライン。押し出しには上限が無いので、この判断が無いと
 *    ボール/味方から離れ続けてアークの 2〜3m 外まで下がる（実測: 立ち止まっている
 *    選手の 11.2% がリムから 8.5m 超、8.8% が 10m 超だった）。
 * ⚠️ 運び上げ中（frontT 前）は掛けない。まだ自陣に居るのが正しい。
 * ⚠️ ディープシューターだけは一歩外に立つ設計なので、そのぶん枠を広げる。
 */
function noOutward(game: Game, p: Player, rx: number, rz: number): [number, number] {
  if (!game.frontT || p === game.handler) return [rx, rz];
  const rim = game.attackFloor(p.team);
  const ox = p.pos.x - rim.x, oz = p.pos.z - rim.z;
  const d = Math.hypot(ox, oz);
  const max = THREE_DIST + (deepThreeOK(p) ? 1.6 : 0.8);
  if (d < max || d < 1e-4) return [rx, rz];
  const out = (rx * ox + rz * oz) / d;                  // 押し出しのうち外向きの成分
  if (out <= 0) return [rx, rz];
  return [rx - (ox / d) * out, rz - (oz / d) * out];    // 横（接線）へ逃がす
}

export function spacingNudge(game: Game, dt: number, p: Player, min = 3.5): void {
  const MIN = min;
  let rx = 0, rz = 0;
  for (const q of game.teamPlayers(p.team)) {
    if (q === p) continue;
    const dx = p.pos.x - q.pos.x, dz = p.pos.z - q.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < MIN && d > 1e-3) {
      const w = (MIN - d) / MIN;
      rx += (dx / d) * w; rz += (dz / d) * w;
    }
  }
  [rx, rz] = noOutward(game, p, rx, rz);
  const rl = Math.hypot(rx, rz);
  if (rl > 1e-3) {
    const step = p.accelSpeed(dt, 0.8) * dt * Math.min(1, rl);   // 分離を押し出す
    moveToward2D(p.pos, p.pos.x + rx / rl, p.pos.z + rz / rl, step);
  }
}

// ボールハンドラーからの連続的な分離(spacingNudge は味方のみ)。min 以内なら真っ直ぐ離れる。
export function ballSpacingNudge(game: Game, dt: number, p: Player, min: number): void {
  const h = game.handler;
  if (!h || h === p) return;
  const dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z;
  const d = Math.hypot(dx, dz);
  if (d >= min || d < 1e-3) return;
  const [ux, uz] = noOutward(game, p, dx / d, dz / d);
  if (Math.abs(ux) + Math.abs(uz) < 1e-3) return;   // 外へ下がる以外に逃げ場が無い → 押さない
  const step = p.accelSpeed(dt, 0.8) * dt * ((min - d) / min);
  moveToward2D(p.pos, p.pos.x + ux, p.pos.z + uz, step);
}

// オープン(守備から遠い)で、ボールから間合いがあり、味方が未占有のフォーメーション
// スポットを選ぶ。
export function bestOpenSpot(game: Game, team: number, spots: Vector3[], self: Player,
  avoid = -1,   // この番号は選ばない（膠着時に「同じ場所」を選び直して動かないのを防ぐ）
): number {
  const rimFloor = game.attackFloor(team);
  let bestI = self.spotIdx;
  let bestScore = -Infinity;
  for (let i = 0; i < spots.length; i++) {
    if (i === avoid) continue;
    const s = spots[i];
    let owned = false;
    for (const q of game.teamPlayers(team)) {
      if (q === self || q.cutting || q.screening || q === game.handler) continue;
      if (q.spotIdx === i || dist2DTo(q.pos, s.x, s.z) < 2.5) { owned = true; break; }
    }
    if (owned) continue;

    let open = Infinity;
    for (const d of game.teamPlayers(1 - team)) open = Math.min(open, dist2DTo(d.pos, s.x, s.z));
    // 味方から最も近い距離: 空きスペース(味方が居ない場所)を選ばせる＝密集回避
    let mate = Infinity;
    for (const q of game.teamPlayers(team)) {
      if (q === self || q === game.handler) continue;
      mate = Math.min(mate, dist2DTo(q.pos, s.x, s.z));
    }
    const fromHandler = game.handler ? dist2DTo(game.handler.pos, s.x, s.z) : 5;
    const lane = game.handler ? laneOpenness(game, game.handler.pos, s.x, s.z) : 1;
    const clog = game.handler ? clogPenalty(game.handler.pos, rimFloor, s.x, s.z) : 0;

    // ローブロック(idx 5/6)はビッグの領域: ガードやストレッチビッグは張らない
    if (i >= 5 && !game.prefersPost(self)) continue;

    let score: number;
    if (i >= 5) {
      score = 6.0 + Math.min(open, 2.0) * 0.5 + lane * 0.8
        + Math.min(mate, 4) * 0.3               // 味方から離れたローブロックを優先
        - clog * 2.5
        - dist2DTo(self.pos, s.x, s.z) * 0.1
        + (self.has("centerSpot") ? 1.5 : 0);
    } else {
      // オフェンスのポジション優先度: ①相手がいない(オープン)を最重視 ②密集回避＝スペーシング
      // ③フリーの味方を作るパスコース ④相手ゴールに近い得点圏 ⑤ボールから適度に離れる。
      const rimDist = dist2DTo(rimFloor, s.x, s.z);
      // スペーシング役(優先度低い/3&D/スポットアップ)ほどワイド(コーナー)を強く好み中央へ寄らない。
      const spaceRole = clamp(1 - self.offPriority, 0, 1)
        + (self.evalRole === "3&D" || self.evalRole === "スポットアップ" ? 0.4 : 0);
      score = open * (self.has("positioning") ? 1.35 : 1) * 1.6    // ①オープン(相手がいない)を最重視=価値UP
        + Math.min(mate, 7) * 1.05              // ②密集回避=スペーシング(味方から離れた空きへ)
        + lane * 2.0                            // ③フリーの味方を作る(パスコースが通る位置)
        + Math.max(0, 9 - rimDist) * 0.15       // ④相手ゴールに近い得点圏を加点(上限9m)=優先度DOWN(密集回避)
        + Math.min(fromHandler, 7) * 0.6        // ⑤ボールから離れる=ドライブ/パスコースのスペース(強化)
        - Math.max(0, 4.5 - fromHandler) * 1.2  // ⑤' ボール至近(4.5m内)のスポットは強く避ける(ボールへ密集させない)
        + Math.abs(s.x) * (0.2 + spaceRole * 0.55)  // ⑥ワイド維持(コーナー)=中央密集回避(スペーシング役ほど強)
        - clog * 2.5                            // ドライブレーンを塞がない
        - dist2DTo(self.pos, s.x, s.z) * 0.1;   // 移動コスト
      if (self.has("sideSpot") && (i === 3 || i === 4)) score += 1.5;
      if (game.prefersPost(self)) score = Math.min(score, 4.0) - 1.5;
    }
    if (score > bestScore) { bestScore = score; bestI = i; }
  }
  return bestI;
}

// from から点(x,z)へのパスレーンの開き具合: 1=守備なし、守備が真正面に座るほど0へ。
function laneOpenness(game: Game, from: Vector3, x: number, z: number): number {
  let minPerp = Infinity;
  for (const d of game.teamPlayers(1 - game.possession)) {
    const { t, perp } = segPerp(from.x, from.z, x, z, d.pos.x, d.pos.z);
    if (t <= 0.1 || t >= 0.95) continue;
    minPerp = Math.min(minPerp, perp);
  }
  return minPerp === Infinity ? 1 : clamp(minPerp / LANE_W, 0, 1);
}

// 点(x,z)がハンドラーのリムへの直線ドライブをどれだけ塞ぐか: 1=走路のど真ん中、0=走路外。
function clogPenalty(from: Vector3, rim: Vector3, x: number, z: number): number {
  const { t, perp } = segPerp(from.x, from.z, rim.x, rim.z, x, z);
  if (t <= 0.05 || t >= 1) return 0;                  // ハンドラーとリムの間でない
  return clamp(1 - perp / 2.0, 0, 1);                 // 走路~2m以内=塞ぐ
}
