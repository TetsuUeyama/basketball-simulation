// コーナーの持ち場へ向かわない理由を、**オフボール更新が実際に走ったフレームだけ**で測る。
// ⚠️ offBranch は更新が走らなかったフレームでは前回値が残る。毎フレーム消してから読むこと。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2DTo } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);

type Rec = { spd: number; close: number; gap: number; br: string };
const recs: Rec[] = [];
let liveFrames = 0, drivenFrames = 0;
const pre = new Map<Player, { x: number; z: number }>();
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    for (const p of game.players) { p.offBranch = ""; pre.set(p, { x: p.pos.x, z: p.pos.z }); }
    game.update(DT);
    if (!game.frontT) continue;
    liveFrames++;
    const spots = game.formationSpots(game.possession);
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler) continue;
      if (!p.offBranch) continue;                     // このフレームは更新が走っていない
      drivenFrames++;
      if (p.spotIdx !== 3 && p.spotIdx !== 4) continue;
      const s = spots[p.spotIdx];
      const gap = dist2DTo(p.pos, s.x, s.z);
      if (gap <= 3.0) continue;
      const pv = pre.get(p)!;
      const spd = Math.hypot(p.pos.x - pv.x, p.pos.z - pv.z) / DT;
      const close = (dist2DTo({ x: pv.x, z: pv.z } as never, s.x, s.z) - gap) / DT;
      recs.push({ spd, close, gap, br: p.offBranch });
    }
  }
}
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  フロントコートのフレーム ${liveFrames} / オフボール駆動サンプル ${drivenFrames}`);
console.log(`\n■ コーナーの持ち場・3m超離れている ${recs.length}件`);
console.log(`  実速度の中央値    : ${med(recs.map((r) => r.spd))} m/s`);
console.log(`  持ち場への接近速度: ${med(recs.map((r) => r.close))} m/s`);
console.log(`  静止(0.3m/s未満)  : ${pc(recs.filter((r) => r.spd < 0.3).length, recs.length)}`);
console.log(`  動くが近づかない  : ${pc(recs.filter((r) => r.spd >= 0.3 && r.close < 0.2).length, recs.length)}`);
console.log(`\n■ 分岐別`);
const brs = [...new Set(recs.map((r) => r.br))];
brs.sort((x, y) => recs.filter((r) => r.br === y).length - recs.filter((r) => r.br === x).length);
for (const b of brs) {
  const a = recs.filter((r) => r.br === b);
  console.log(`  ${b.padEnd(12)} ${String(a.length).padStart(6)}件 ${pc(a.length, recs.length).padStart(7)}`
    + `  実速 ${med(a.map((r) => r.spd))} / 接近 ${med(a.map((r) => r.close))} m/s  距離 ${med(a.map((r) => r.gap))}m`);
}
