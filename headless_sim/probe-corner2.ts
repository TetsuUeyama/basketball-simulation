// コーナーの持ち場に就いた選手が「なぜ辿り着かないか」を切り分ける。
//   ①持ち場が入れ替わり続けている(churn)のか ②向かっているが遅いのか ③途中で止まるのか
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

// 選手ごとに「今の spotIdx を何秒保持しているか」と直前位置
const held = new Map<Player, { idx: number; t: number; px: number; pz: number }>();
let samples = 0;
const gapBy: number[][] = [[], [], [], []];   // 保持 0-1s / 1-2s / 2-4s / 4s+
let stalled = 0, approaching = 0, arrived = 0, receding = 0;
const churn: number[] = [];   // 持ち場を手放した時の保持秒数
let cornerOccupied = 0, frontFrames = 0;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (!game.frontT) continue;
    const spots = game.formationSpots(game.possession);
    frontFrames++;
    let occ = false;
    for (const p of game.teamPlayers(game.possession)) {
      const rim = game.attackFloor(p.team);
      if (Math.abs(p.pos.x) > 6.0 && Math.abs(p.pos.z - rim.z) < 3.0) occ = true;
      if (p === game.handler) { held.delete(p); continue; }
      const h = held.get(p);
      if (!h || h.idx !== p.spotIdx) {
        if (h) churn.push(h.t);
        held.set(p, { idx: p.spotIdx, t: 0, px: p.pos.x, pz: p.pos.z });
        continue;
      }
      const s = spots[p.spotIdx];
      const gap = dist2DTo(p.pos, s.x, s.z);
      const prevGap = dist2DTo({ x: h.px, z: h.pz } as never, s.x, s.z);
      if (p.spotIdx === 3 || p.spotIdx === 4) {
        samples++;
        const b = h.t < 1 ? 0 : h.t < 2 ? 1 : h.t < 4 ? 2 : 3;
        gapBy[b].push(gap);
        if (gap < 1.2) arrived++;
        else if (prevGap - gap > 0.004) approaching++;       // 1フレームで 0.24cm 以上詰めた
        else if (gap - prevGap > 0.004) receding++;
        else stalled++;
      }
      h.t += DT; h.px = p.pos.x; h.pz = p.pos.z;
    }
    if (occ) cornerOccupied++;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
const med = (a: number[]) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
console.log(`${NG}試合  コーナーの持ち場(spotIdx 3/4)のサンプル ${samples}件`);
console.log(`\n■ 持ち場との距離（保持時間別の中央値）`);
console.log(`  0〜1秒: ${med(gapBy[0])}m (${gapBy[0].length}件)`);
console.log(`  1〜2秒: ${med(gapBy[1])}m (${gapBy[1].length}件)`);
console.log(`  2〜4秒: ${med(gapBy[2])}m (${gapBy[2].length}件)`);
console.log(`  4秒以上: ${med(gapBy[3])}m (${gapBy[3].length}件)`);
console.log(`\n■ 何をしているか`);
console.log(`  到着済み(1.2m以内): ${pc(arrived, samples)}`);
console.log(`  近づいている      : ${pc(approaching, samples)}`);
console.log(`  止まっている      : ${pc(stalled, samples)}`);
console.log(`  遠ざかっている    : ${pc(receding, samples)}`);
console.log(`\n■ 持ち場の入れ替わり  ${churn.length}回 / 保持秒数の中央値 ${med(churn)}秒`);
console.log(`■ コーナー(|x|>6.0)に誰か居るフレーム: ${pc(cornerOccupied, frontFrames)}`);
