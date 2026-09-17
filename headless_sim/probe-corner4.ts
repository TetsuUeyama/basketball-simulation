// コーナーの持ち場に居る選手の **実速度** と、持ち場への接近速度を分けて測る。
// ⚠️ 距離変化だけで「止まっている」と判定すると、接線方向(周回・押し出しの逃がし)に
//    全速で動いている選手まで止まって見える。実変位と併せて測ること。
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

const prev = new Map<Player, { x: number; z: number }>();
type Rec = { spd: number; close: number; gap: number; br: string };
const recs: Rec[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (!game.frontT) continue;
    const spots = game.formationSpots(game.possession);
    for (const p of game.teamPlayers(game.possession)) {
      const pv = prev.get(p);
      prev.set(p, { x: p.pos.x, z: p.pos.z });
      if (p === game.handler || !pv) continue;
      if (p.spotIdx !== 3 && p.spotIdx !== 4) continue;
      const s = spots[p.spotIdx];
      const gap = dist2DTo(p.pos, s.x, s.z);
      if (gap <= 3.0) continue;                              // 遠い時だけ見る
      const spd = Math.hypot(p.pos.x - pv.x, p.pos.z - pv.z) / DT;
      const close = (dist2DTo({ x: pv.x, z: pv.z } as never, s.x, s.z) - gap) / DT;
      recs.push({ spd, close, gap, br: p.offBranch || "?" });
    }
  }
}
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  コーナーの持ち場・3m超離れている ${recs.length}件`);
console.log(`  実速度の中央値      : ${med(recs.map((r) => r.spd))} m/s`);
console.log(`  持ち場への接近速度  : ${med(recs.map((r) => r.close))} m/s`);
console.log(`  本当に静止(0.3m/s未満): ${pc(recs.filter((r) => r.spd < 0.3).length, recs.length)}`);
console.log(`  動いているが接近していない(実速0.3超・接近0.2未満): `
  + pc(recs.filter((r) => r.spd >= 0.3 && r.close < 0.2).length, recs.length));
console.log(`\n■ 分岐別（3m超）`);
const brs = [...new Set(recs.map((r) => r.br))];
for (const b of brs.sort((x, y) => recs.filter((r) => r.br === y).length - recs.filter((r) => r.br === x).length)) {
  const a = recs.filter((r) => r.br === b);
  console.log(`  ${b.padEnd(12)} ${String(a.length).padStart(6)}件  実速 ${med(a.map((r) => r.spd))} / 接近 ${med(a.map((r) => r.close))} m/s  距離 ${med(a.map((r) => r.gap))}m`);
}
