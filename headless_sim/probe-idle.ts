// ボール保持者が止まったとき、他の選手も止まっているか。止まっているなら
// 「やることが無い」のか「やることがあるのに止まっている」のかを見る。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { attnTo } from "../src/ai/attention";
import { MOVE_LOG, MOVE_TRACE } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const STILL = 0.4;   // これ未満を「止まっている」とする(m/s)

const d2 = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

let handlerStillF = 0, handlerMoveF = 0;
// ハンドラーが止まっているとき / 動いているとき の「他の選手も止まっている率」
let othersStillWhenStill = 0, othersWhenStill = 0;
let othersStillWhenMove = 0, othersWhenMove = 0;
// 止まっている選手が「やることがある」状態か
let idleWithJob = 0, idleNoJob = 0;
// ハンドラーを見ていない選手が、ハンドラーの停止に合わせて止まっているか
let blindStill = 0, blindAll = 0, seeStill = 0, seeAll = 0;
let stillRun = 0;   // ハンドラーが止まり続けたフレーム数
let noOrder = 0;
const byTeam: Record<string, number> = {};
const bySide: Record<string, { all: number; still: number }> = {};
const noOrderState: Record<string, number> = {};
const offSpd: number[] = [], offGap: number[] = [];
let circleOK = 0, circleAll = 0;
const stopWhy: Record<string, number> = {};
const freeSite: Record<string, number> = {};
MOVE_TRACE.on = true;
MOVE_TRACE.site = false;   // 目標だけ要る（スタック取得は重い）

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    for (const a of MOVE_LOG.values()) a.length = 0;
    game.update(DT);
    if (game.ballMode !== "held" || !game.handler) { stillRun = 0; continue; }
    const h = game.handler;
    const hStill = Math.hypot(h.velX, h.velZ) < STILL;
    stillRun = hStill ? stillRun + 1 : 0;
    if (hStill) handlerStillF++; else handlerMoveF++;
    const spots = game.formationSpots(game.possession);
    const off = game.teamPlayers(game.possession);
    for (const p of game.players) {
      if (p === h) continue;
      const still = Math.hypot(p.velX, p.velZ) < STILL;
      const sideKey = p.team === game.possession ? "攻撃" : "守備";
      if (hStill) {
        othersWhenStill++; if (still) othersStillWhenStill++;
        bySide[sideKey] = bySide[sideKey] ?? { all: 0, still: 0 };
        bySide[sideKey].all++; if (still) bySide[sideKey].still++;
      }
      else { othersWhenMove++; if (still) othersStillWhenMove++; }
      // ハンドラーを見ているか
      if (hStill && stillRun > 30) {
        const sees = attnTo(p, h) > 0.8;
        if (sees) { seeAll++; if (still) seeStill++; }
        else { blindAll++; if (still) blindStill++; }
      }
      // ⚠️ 持ち場での周回（freePhase）が効いているか: スポットとの距離と速さを見る。
      if (hStill && stillRun > 30 && p.team === game.possession) {
        const sp2 = spots[p.spotIdx];
        offSpd.push(Math.hypot(p.velX, p.velZ));
        if (sp2) {
          const dd2 = d2(p.pos, sp2);
          offGap.push(dd2);
          if (dd2 < 1.6 && p.spotIdx < 5) circleOK++;
          circleAll++;
        }
      }
      if (!hStill || !still || stillRun <= 30) continue;
      // ⚠️ 「やることがある」を自分で定義すると取り違える（前回スポットで誤判定した）。
      //    AI が実際に出した移動命令（MOVE_LOG）を見る。命令があるのに動いていない＝
      //    足が止められている。命令が無い＝AI が「立っていろ」と決めている。
      // ⚠️ 足が止められている理由（自分が入れた押し合い・よろめきが犯人かもしれない）
      if (p.team === game.possession) {
        if (p.shovedT > 0) stopWhy["押され(shovedT)"] = (stopWhy["押され(shovedT)"] ?? 0) + 1;
        else if (p.foulReactT > 0) stopWhy["よろめき"] = (stopWhy["よろめき"] ?? 0) + 1;
        else if (p.rootT > 0) stopWhy["硬直(rootT)"] = (stopWhy["硬直(rootT)"] ?? 0) + 1;
        else if (p.coolT > 0) stopWhy["クール(coolT)"] = (stopWhy["クール(coolT)"] ?? 0) + 1;
        else if (p.plantT > 0) stopWhy["プラント"] = (stopWhy["プラント"] ?? 0) + 1;
        else {
          stopWhy["足は自由"] = (stopWhy["足は自由"] ?? 0) + 1;
          // 足が自由なのに動いていない選手に、どの命令が出ているか
          const lg = MOVE_LOG.get(p.pos) ?? [];
          if (!lg.length) freeSite["(命令なし)"] = (freeSite["(命令なし)"] ?? 0) + 1;
          else {
            const l = lg[lg.length - 1];
            const dd3 = Math.hypot(l.tx - p.pos.x, l.tz - p.pos.z);
            const key = l.site + " 目標まで" + (dd3 < 0.3 ? "0.3m未満" : dd3 < 1 ? "1m未満" : "1m超");
            freeSite[key] = (freeSite[key] ?? 0) + 1;
          }
        }
      }
      const logs = MOVE_LOG.get(p.pos) ?? [];
      let want = 0;
      for (const l of logs) want = Math.max(want, Math.hypot(l.tx - p.pos.x, l.tz - p.pos.z));
      if (!logs.length) {
        noOrder++;
        // どの状態のときに命令が出ていないかを数える（分岐の特定）
        const k = (p.screening ? "スクリーン " : "") + (p.cutting ? "カット " : "")
          + (p.postT > 0 ? "ポスト " : "") + (p.shakeOpenT > 0 ? "マーク外し " : "")
          + (p.gatherT > 0 ? "ギャザー " : "") + (p.rootT > 0 ? "硬直 " : "")
          + (p.screenT > 0 ? "screenT " : "") + (p.openRollT > 0 ? "ロール " : "");
        noOrderState[k || "(印なし)"] = (noOrderState[k || "(印なし)"] ?? 0) + 1;
      }
      else if (want > 1.0) idleWithJob++;      // 1m以上先へ行けと言われているのに止まっている
      else idleNoJob++;                        // 目の前が目標＝実質その場
      byTeam[p.team === game.possession ? "攻撃" : "守備"] =
        (byTeam[p.team === game.possession ? "攻撃" : "守備"] ?? 0) + (logs.length ? 0 : 1);
    }
  }
}
const pc = (a: number, b: number): string => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(NG + "試合  ボール保持中のフレーム: 止まっている " + handlerStillF
  + " / 動いている " + handlerMoveF);
console.log("他の9人が止まっている割合: ハンドラーが止まっているとき "
  + pc(othersStillWhenStill, othersWhenStill)
  + " / 動いているとき " + pc(othersStillWhenMove, othersWhenMove));
console.log("  内訳（ハンドラー停止中の停止率）: "
  + Object.entries(bySide).map(([k, v]) => k + " " + pc(v.still, v.all)).join(" / "));
console.log("ハンドラーが0.5秒以上止まっているときに**止まっている選手**の内訳: "
  + "やることがある(持ち場に未着/マークから2m超) " + idleWithJob
  + " / やることが無い " + idleNoJob
  + "（やることがあるのに止まっている率 " + pc(idleWithJob, idleWithJob + idleNoJob) + "）");
console.log("  → 移動命令そのものが出ていない: " + noOrder
  + "（攻撃 " + (byTeam["攻撃"] ?? 0) + " / 守備 " + (byTeam["守備"] ?? 0) + "）");
console.log("    命令が出ていないときの状態: "
  + Object.entries(noOrderState).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, n]) => k + " " + n).join(" / "));
{
  const md = (a: number[]): string => a.length
    ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(2) : "-";
  console.log("  ハンドラー停止中のオフボール攻撃: 速さ 中央 " + md(offSpd) + "m/s"
    + " / スポットまで 中央 " + md(offGap) + "m"
    + " / 周回の条件を満たす(1.6m以内・外の枠) " + (circleOK / Math.max(1, circleAll) * 100).toFixed(0) + "%");
}
console.log("  止まっている攻撃側の足の状態: " + Object.entries(stopWhy)
  .sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " " + n).join(" / "));
console.log("  足が自由なのに動かない選手への命令: " + Object.entries(freeSite)
  .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + " " + n).join(" / "));
console.log("注目別の停止率: ハンドラーを見ている " + pc(seeStill, seeAll)
  + " / 見ていない " + pc(blindStill, blindAll)
  + "  ※見ていない側が同じくらい止まっているなら、見ていないのに気づいて止まっている");
