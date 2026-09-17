// コーナーの待機位置と、コーナーから打った球が 2P/3P どちらで数えられるかを測る。
// ⚠️ 描画（court.ts）はコーナーが x=±THREE_CORNER_X の直線。半径だけで判定すると
//    ベースライン寄りで「線の外なのに2P」が出る。beyondArc と半径判定を並べて比べる。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST, THREE_CORNER_X, beyondArc } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);

// コーナーの持ち場(spotIdx 3,4)に就いている選手の立ち位置
const cornerX: number[] = [];
let cornerN = 0, cornerOutArc = 0, cornerOutLine = 0;
// 打った球: コーナー領域（リムから 2.5m 以内の z、|x|>5.0）だけ拾う
type Shot = { x: number; dz: number; r: number; pts: number };
const shots: Shot[] = [];
let allFGA = 0, all3 = 0;
let lastShooter: Player | null = null;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const before = game.shooter;
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== before && sh !== lastShooter) {
      lastShooter = sh;
      const rim = game.attackFloor(sh.team);
      allFGA++;
      if (game.shotPoints === 3) all3++;
      const dz = Math.abs(sh.pos.z - rim.z);
      if (Math.abs(sh.pos.x) > 5.0 && dz < 2.5) {
        shots.push({ x: Math.abs(sh.pos.x), dz, r: dist2D(sh.pos, rim), pts: game.shotPoints });
      }
    }
    if (!sh) lastShooter = null;
    if (i % 20 || !game.frontT) continue;
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler) continue;
      if (p.spotIdx !== 3 && p.spotIdx !== 4) continue;   // コーナーの持ち場のみ
      const rim = game.attackFloor(p.team);
      cornerN++;
      cornerX.push(Math.abs(p.pos.x));
      if (dist2D(p.pos, rim) > THREE_DIST) cornerOutArc++;
      if (beyondArc(p.pos.x, p.pos.z, rim.z)) cornerOutLine++;
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
cornerX.sort((a, b) => a - b);
const q = (f: number) => cornerX.length ? cornerX[Math.floor((cornerX.length - 1) * f)].toFixed(2) : "-";
console.log(`${NG}試合  アーク ${THREE_DIST}m / コーナーの直線 x=±${THREE_CORNER_X}`);
console.log(`\n■ コーナーの持ち場に就いている選手の |x|（${cornerN}件）`);
console.log(`  25% ${q(0.25)} / 中央 ${q(0.5)} / 75% ${q(0.75)}`);
console.log(`  半径判定で3Pの外: ${pc(cornerOutArc, cornerN)}`);
console.log(`  描画の線の外    : ${pc(cornerOutLine, cornerN)}  ← こちらが実際に見える線`);
console.log(`\n■ コーナー領域からの試投（|x|>5.0 かつ リムから z 2.5m 以内, ${shots.length}本）`);
console.log(`  3Pとして数えた: ${pc(shots.filter((s) => s.pts === 3).length, shots.length)}`);
for (const [lo, hi] of [[5.0, 6.0], [6.0, 6.6], [6.6, 7.2], [7.2, 99]]) {
  const a = shots.filter((s) => s.x >= lo && s.x < hi);
  if (!a.length) continue;
  console.log(`  |x| ${lo}〜${hi}: ${a.length}本  3P率 ${pc(a.filter((s) => s.pts === 3).length, a.length)}`
    + `  半径中央 ${a.map((s) => s.r).sort((p2, q2) => p2 - q2)[Math.floor((a.length - 1) / 2)].toFixed(2)}m`);
}
console.log(`\n■ 全体  試投 ${allFGA}本 / 3P ${all3}本 (${pc(all3, allFGA)})  1試合あたり3PA ${(all3 / NG / 2).toFixed(1)}本/チーム`);
