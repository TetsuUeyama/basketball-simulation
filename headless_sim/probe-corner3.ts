// コーナーの持ち場を保持したまま遠くで止まっている選手が、どの分岐に居るかを数える。
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

const all = new Map<string, number>();       // 全オフボール
const farStall = new Map<string, number>();  // コーナー持ち場・3m超・止まっている
const prev = new Map<Player, { x: number; z: number }>();
let samples = 0, farStallN = 0;
const gapOf = new Map<string, number[]>();

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (!game.frontT) continue;
    const spots = game.formationSpots(game.possession);
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler) { prev.delete(p); continue; }
      if (p.spotIdx !== 3 && p.spotIdx !== 4) { prev.set(p, { x: p.pos.x, z: p.pos.z }); continue; }
      const s = spots[p.spotIdx];
      const gap = dist2DTo(p.pos, s.x, s.z);
      const b = p.offBranch || "?";
      samples++;
      all.set(b, (all.get(b) ?? 0) + 1);
      if (!gapOf.has(b)) gapOf.set(b, []);
      gapOf.get(b)!.push(gap);
      const pv = prev.get(p);
      if (pv && gap > 3.0) {
        const pg = dist2DTo({ x: pv.x, z: pv.z } as never, s.x, s.z);
        if (Math.abs(pg - gap) < 0.004) { farStall.set(b, (farStall.get(b) ?? 0) + 1); farStallN++; }
      }
      prev.set(p, { x: p.pos.x, z: p.pos.z });
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const show = (m: Map<string, number>, tot: number, title: string) => {
  console.log("\n■ " + title + "  (" + tot + "件)");
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + k.padEnd(12) + pc(v, tot).padStart(7)
      + (gapOf.has(k) ? "   持ち場との距離 中央値 " + med(gapOf.get(k)!) + "m" : ""));
  }
};
console.log(`${NG}試合  コーナーの持ち場(spotIdx 3/4)`);
show(all, samples, "分岐の内訳（全サンプル）");
show(farStall, farStallN, "3m超離れて止まっている時の分岐");
