// 注目システムとパスコース争いの実測。
//   ・誰が何を見ているか（顔の向きの内訳）
//   ・パスコースを潰された(fronted)攻撃側が、バックドア/シールで抜け返せているか
//   ・見ていない方向への反応が実際に鈍っているか（カット率・ルーズ球の反応）
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { attnFactor, ATTN } from "../src/ai/attention";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);

const gaze = new Map<string, number>();
let frames = 0, denyF = 0, frontedF = 0, backdoor = 0, seal = 0;
let cuts = 0, passes = 0, tos = 0, pts = [0, 0];
// 「ボールを見ていない」割合（守備のオフボールだけ）
let offBallDef = 0, offBallDefBlind = 0;
// 注目の効き目: マークを見ている守備者に対するバックドア成功
const prevBack = new Map<Player, number>();

ATTN.power = Number(process.env.ATTN ?? 1);
let steals = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  prevBack.clear();
  let lastMode = "";
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    frames++;
    if (game.ballMode !== lastMode) {
      if (game.ballMode === "pass") passes++;
      if (game.ballMode === "loose" && game.looseStealBy) steals++;
      lastMode = game.ballMode;
    }
    for (const p of game.players) {
      gaze.set(p.gazeKind, (gaze.get(p.gazeKind) ?? 0) + 1);
      if (p.denyT > 0) denyF++;
      if (p.frontedT > 0) frontedF++;
      const was = prevBack.get(p) ?? 0;
      if (p.backdoorT > was + 0.5) backdoor++;      // 立ち上がった瞬間だけ数える
      prevBack.set(p, p.backdoorT);
      if (p.shakeOpenT > 0 && p.shakePower) seal++;
      if (p.team !== game.possession && game.handler && game.handler !== p) {
        offBallDef++;
        if (attnFactor(p, game.ball.pos.x, game.ball.pos.z) < 0.75) offBallDefBlind++;
      }
    }
  }
  pts[0] += game.score[0]; pts[1] += game.score[1];
  tos += (game.stats?.[0]?.to ?? 0) + (game.stats?.[1]?.to ?? 0);
}
void cuts;
console.log(NG + "試合 / " + frames + "フレーム / 注目の効きめ ATTN.power=" + ATTN.power);
const tot = [...gaze.values()].reduce((a, b) => a + b, 0);
console.log("顔が向いている先（のべフレーム）: "
  + [...gaze].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => k + " " + (n / tot * 100).toFixed(1) + "%").join(" / "));
console.log("レーンを塞いでいる守備: " + (denyF / frames).toFixed(2) + "人/フレーム"
  + " / 潰されている攻撃: " + (frontedF / frames).toFixed(2) + "人/フレーム");
console.log("バックドア発動 " + backdoor + "回（" + (backdoor / NG).toFixed(1) + "回/試合）"
  + " / シール中 " + (seal / frames).toFixed(2) + "人/フレーム");
console.log("オフボール守備がボールを見ていない割合: "
  + (offBallDefBlind / Math.max(1, offBallDef) * 100).toFixed(1) + "%");
console.log("得点 " + (pts[0] / NG).toFixed(1) + " - " + (pts[1] / NG).toFixed(1)
  + " / パス " + (passes / NG).toFixed(0) + "本/試合");
console.log("守備がボールを奪った回数: " + (steals / NG).toFixed(1) + "/試合");
void tos;
