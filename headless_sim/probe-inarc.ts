// 「持ち場に着いているペリメーターの選手」が、描画の3Pラインの内側に居る割合。
// ⚠️ 持ち場の周りを回る動き(freeRun, 半径 0.7〜1.6m)が内側へ食い込んでいないかを見る。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D, dist2DTo } from "../src/util";
import { beyondArc, THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);
let n = 0, inside = 0, cn = 0, cIn = 0;
const depth: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (!game.frontT || i % 4) continue;
    const spots = game.formationSpots(game.possession);
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler || p.spotIdx >= 5 || p.cutting || p.screening) continue;
      const s = spots[p.spotIdx];
      if (dist2DTo(p.pos, s.x, s.z) > 2.0) continue;      // 持ち場に着いている時だけ
      const rim = game.attackFloor(p.team);
      const out = beyondArc(p.pos.x, p.pos.z, rim.z);
      n++; if (!out) { inside++; depth.push(THREE_DIST - dist2D(p.pos, rim)); }
      if (p.spotIdx === 3 || p.spotIdx === 4) { cn++; if (!out) cIn++; }
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
console.log(`${NG}試合  持ち場に着いているペリメーターのオフボール ${n}件`);
console.log(`  描画の3Pラインの**内側**に居る: ${pc(inside, n)}   食い込みの中央値 ${med(depth)}m`);
console.log(`  うちコーナーの持ち場: ${pc(cIn, cn)} (${cn}件)`);
