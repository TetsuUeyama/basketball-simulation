// ③ センターがゴール下に居ない理由を切り分ける。
//   ポストアンカーに選ばれているか / 持ち場はどこか / 実際どこに居るか / 何の分岐で動いているか
import "./stubs";
let _s = 0;
const setSeed = (v: number): void => { _s = v >>> 0; };
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b,0xc2b2ae35").split(",").map((v) => Number(v) >>> 0);

let cN = 0, cAnchor = 0, cPost = 0;
const cRim: number[] = [];
const spotOf: Record<number, number> = {};
const branchOf: Record<string, number> = {};
const gapToSpot: number[] = [];
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    for (let i = 0; i < 60 * 60 * 8; i++) {
      for (const q of game.players) q.offBranch = "";
      game.update(DT);
      if (!game.frontT || i % 6) continue;
      const off = game.possession;
      const spots = game.formationSpots(off);
      for (const p of game.teamPlayers(off)) {
        if (p.role !== "C" || p === game.handler) continue;
        cN++;
        const rim = game.attackFloor(off);
        cRim.push(dist2D(p.pos, rim));
        if (p === game.postAnchor(off)) cAnchor++;
        if (game.prefersPost(p)) cPost++;
        spotOf[p.spotIdx] = (spotOf[p.spotIdx] ?? 0) + 1;
        if (p.offBranch) branchOf[p.offBranch] = (branchOf[p.offBranch] ?? 0) + 1;
        const s = spots[p.spotIdx];
        if (s) gapToSpot.push(dist2D(p.pos, s));
      }
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const NAMES = ["0 トップ", "1 左ウイング", "2 右ウイング", "3 左コーナー", "4 右コーナー", "5 ローブロック", "6 ショートコーナー"];
console.log(`${NG * SEEDS.length}試合  役割Cのサンプル ${cN}件（ハンドラーの時を除く）`);
console.log(`  postAnchor に選ばれている: ${pc(cAnchor, cN)}`);
console.log(`  prefersPost が true      : ${pc(cPost, cN)}`);
console.log(`  リムからの距離 中央 ${med(cRim)}m / ゴール下(3.5m内) ${pc(cRim.filter((v) => v < 3.5).length, cN)}`);
console.log(`  自分の持ち場との距離 中央 ${med(gapToSpot)}m`);
console.log(`\n■ どの持ち場に就いているか`);
for (let i = 0; i < 7; i++) if (spotOf[i]) console.log(`  ${NAMES[i].padEnd(14)} ${pc(spotOf[i], cN)}`);
console.log(`\n■ オフボールのどの分岐で動いているか（更新が走ったフレームのみ）`);
const tot = Object.values(branchOf).reduce((s, v) => s + v, 0);
for (const [k, v] of Object.entries(branchOf).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(13)} ${pc(v, tot)}`);
}
