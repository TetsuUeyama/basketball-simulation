// 仮説: コーナーの持ち場は**着く前に付け替えられている**。
//   持ち場を割り当てられてから到着(1.6m以内)するまでに、何回付け替わるかを測る。
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

type Trip = { idx: number; t: number; startGap: number; minGap: number };
const trips = new Map<Player, Trip>();
const done: { arrived: boolean; t: number; idx: number; startGap: number; minGap: number }[] = [];
let cornerHeld = 0, frames = 0;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (!game.frontT) continue;
    frames++;
    const spots = game.formationSpots(game.possession);
    let anyCorner = false;
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler) { trips.delete(p); continue; }
      const s = spots[p.spotIdx];
      const gap = dist2DTo(p.pos, s.x, s.z);
      if (p.spotIdx === 3 || p.spotIdx === 4) { if (gap < 1.6) anyCorner = true; }
      const tr = trips.get(p);
      if (!tr || tr.idx !== p.spotIdx) {
        if (tr) done.push({ arrived: false, t: tr.t, idx: tr.idx, startGap: tr.startGap, minGap: tr.minGap });
        trips.set(p, { idx: p.spotIdx, t: 0, startGap: gap, minGap: gap });
        continue;
      }
      tr.t += DT; tr.minGap = Math.min(tr.minGap, gap);
      if (gap < 1.6 && tr.startGap >= 3.0) {
        done.push({ arrived: true, t: tr.t, idx: tr.idx, startGap: tr.startGap, minGap: tr.minGap });
        trips.set(p, { idx: -99, t: 0, startGap: gap, minGap: gap });   // 記録済み
      }
    }
    if (anyCorner) cornerHeld++;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const look = (name: string, f: (d: typeof done[0]) => boolean) => {
  const a = done.filter((d) => f(d) && d.startGap >= 3.0);
  const ok = a.filter((d) => d.arrived);
  console.log(`  ${name.padEnd(10)} ${String(a.length).padStart(5)}回  到着 ${pc(ok.length, a.length).padStart(7)}`
    + `  放棄時の残り距離 中央値 ${med(a.filter((d) => !d.arrived).map((d) => d.minGap))}m`
    + `  保持 ${med(a.map((d) => d.t))}秒`);
};
console.log(`${NG}試合  「持ち場を割り当てられてから到着するまで」(開始時 3m超のみ)`);
look("全持ち場", () => true);
look("コーナー", (d) => d.idx === 3 || d.idx === 4);
look("ウイング", (d) => d.idx === 1 || d.idx === 2);
look("トップ", (d) => d.idx === 0);
look("ポスト", (d) => d.idx >= 5);
console.log(`\n■ コーナーの持ち場に誰かが到着しているフレーム: ${pc(cornerHeld, frames)}`);
