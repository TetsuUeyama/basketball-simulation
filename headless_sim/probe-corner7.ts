// 持ち場への移動が中断する理由を分ける: ①持ち場の付け替え ②ポゼッション終了 ③自分がハンドラーに
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
type End = "arrive" | "repick" | "possession" | "handler";
const done: { how: End; idx: number; t: number; startGap: number; minGap: number }[] = [];
let cornerHeld = 0, frames = 0;
const startGaps: number[][] = [[], [], [], []];

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let poss = game.possession;
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (game.possession !== poss) {
      for (const [p, tr] of trips) if (tr.idx >= 0) done.push({ how: "possession", ...tr });
      trips.clear(); poss = game.possession;
    }
    if (!game.frontT) continue;
    frames++;
    const spots = game.formationSpots(game.possession);
    let anyCorner = false;
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler) {
        const t0 = trips.get(p);
        if (t0 && t0.idx >= 0) done.push({ how: "handler", ...t0 });
        trips.delete(p); continue;
      }
      const s = spots[p.spotIdx];
      const gap = dist2DTo(p.pos, s.x, s.z);
      if ((p.spotIdx === 3 || p.spotIdx === 4) && gap < 1.6) anyCorner = true;
      const tr = trips.get(p);
      if (!tr || tr.idx !== p.spotIdx) {
        if (tr && tr.idx >= 0) done.push({ how: "repick", ...tr });
        trips.set(p, { idx: p.spotIdx, t: 0, startGap: gap, minGap: gap });
        const b = p.spotIdx >= 5 ? 3 : p.spotIdx === 0 ? 2 : p.spotIdx <= 2 ? 1 : 0;
        startGaps[b].push(gap);
        continue;
      }
      tr.t += DT; tr.minGap = Math.min(tr.minGap, gap);
      if (gap < 1.6 && tr.startGap >= 3.0) {
        done.push({ how: "arrive", ...tr });
        trips.set(p, { idx: -99, t: 0, startGap: gap, minGap: gap });
      }
    }
    if (anyCorner) cornerHeld++;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const look = (name: string, f: (i: number) => boolean, gaps: number[]) => {
  const a = done.filter((d) => f(d.idx) && d.startGap >= 3.0);
  const by = (h: End) => pc(a.filter((d) => d.how === h).length, a.length).padStart(7);
  console.log(`  ${name.padEnd(8)} ${String(a.length).padStart(5)}回  到着${by("arrive")}`
    + ` / 付け替え${by("repick")} / ポゼ終了${by("possession")} / 自分が持った${by("handler")}`
    + `   開始距離 中央値 ${med(gaps)}m`);
};
console.log(`${NG}試合  持ち場への移動の終わり方（開始時 3m超のみ）`);
look("コーナー", (i) => i === 3 || i === 4, startGaps[0]);
look("ウイング", (i) => i === 1 || i === 2, startGaps[1]);
look("トップ", (i) => i === 0, startGaps[2]);
look("ポスト", (i) => i >= 5, startGaps[3]);
console.log(`\n■ コーナーに誰かが到着しているフレーム: ${pc(cornerHeld, frames)}`);
