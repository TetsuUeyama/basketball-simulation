// 1on1 でスティールをどれだけ仕掛けているか、当たっているか、空振りしているか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);

let starts = 0, fired = 0, whiff = 0, tos = 0;
let heldFrames = 0, inRangeFrames = 0, busyFrames = 0;
const gapAtStart: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const phase = new Map<Player, string>();
  let prevPoss = game.possession;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const h = game.handler;
    if (h && game.ballMode === "held") {
      heldFrames++;
      const man = game.teamPlayers(1 - h.team)[h.slot];
      if (man) {
        const gp = dist2D(man.pos, h.pos);
        if (gp < 1.4) inRangeFrames++;          // 手が届く〜一歩の間合い
        if (man.actKind === "steal" && man.actPhase) busyFrames++;
      }
    }
    for (const p of game.players) {
      const now = p.actKind === "steal" ? p.actPhase : "";
      const was = phase.get(p) ?? "";
      if (!was && now === "windup") {
        starts++;
        const hh = game.handler;
        if (hh) gapAtStart.push(dist2D(p.pos, hh.pos));
      }
      if (was === "windup" && now && now !== "windup") fired++;
      phase.set(p, now);
    }
    if (game.possession !== prevPoss) { prevPoss = game.possession; }
  }
  tos += 0;
}
whiff = fired;   // 実行フレームに届いたか届かなかったかは下で内訳を出せないので総数
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`${NG} 試合（各4分）`);
console.log(`スティールの仕掛け ${starts} 回 = 試合あたり ${(starts / NG).toFixed(1)} 回`);
console.log(`  うち実行フレームまで到達 ${fired} 回`);
console.log(`  仕掛けた時の間合い 中央 ${q(gapAtStart, .5)}m`);
console.log(`ボール保持中のフレーム ${heldFrames}`);
console.log(`  担当守備者が 1.4m 以内 ${(inRangeFrames / Math.max(1, heldFrames) * 100).toFixed(0)}%`);
console.log(`  そのうち突きの最中 ${(busyFrames / Math.max(1, inRangeFrames) * 100).toFixed(1)}%`);
