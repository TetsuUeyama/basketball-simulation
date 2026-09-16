// ①オフボールの立ち位置が3Pラインの外か ②パスを受けた瞬間の距離
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);
let standN = 0, standOut = 0, justIn = 0;
const catchD: number[] = [];
let prevHandler: Player | null = null;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    // ⚠️ パス飛行中は handler が null になる。直前の**非null**のハンドラーと比べる。
    const h = game.handler;
    if (h && prevHandler && h !== prevHandler && h.team === prevHandler.team) {
      catchD.push(dist2D(h.pos, game.attackFloor(h.team)));
    }
    if (h) prevHandler = h;
    if (i % 20 || !game.frontT) continue;
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler || p.spotIdx >= 5) continue;   // ペリメーターの持ち場のみ
      const d = dist2D(p.pos, game.attackFloor(p.team));
      standN++;
      if (d > THREE_DIST) standOut++;
      if (d > THREE_DIST - 0.8 && d <= THREE_DIST) justIn++;
    }
  }
}
void prevHandler;
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  3Pライン ${THREE_DIST}m`);
console.log(`\n■ ペリメーターのオフボールの立ち位置（${standN}件）`);
console.log(`  3Pラインより外: ${pc(standOut, standN)}`);
console.log(`  ラインのすぐ内側(6.0〜6.75m): ${pc(justIn, standN)} ← あと一歩で3P`);
catchD.sort((a, b) => a - b);
const q = (f: number) => catchD.length ? catchD[Math.floor((catchD.length - 1) * f)].toFixed(2) : "-";
const out = catchD.filter((d) => d > THREE_DIST).length;
console.log(`\n■ パスを受けた瞬間の距離（${catchD.length}件）`);
console.log(`  25% ${q(0.25)}m / 中央 ${q(0.5)}m / 75% ${q(0.75)}m`);
console.log(`  3Pラインより外で受けた: ${pc(out, catchD.length)}`);
console.log(`  6.0〜6.75m で受けた: ${pc(catchD.filter((d) => d > 6.0 && d <= THREE_DIST).length, catchD.length)} ← あと一歩`);
