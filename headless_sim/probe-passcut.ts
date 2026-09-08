// パスカットが「レーンに立っていた相手」ではなく「走り込んできた相手」で
// 起きているかを測る。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { segPerp, dist2D } from "../src/util";
import { LANE_W } from "../src/config";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);

let passes = 0, cuts = 0, inLane = 0, closing = 0;
let thrownIntoLane = 0;      // リリース時にレーンへ相手が立っていたパス
const laneGap: number[] = [];  // リリース時、レーンに一番近い相手の距離
const perpAt: number[] = [];
const passLen: number[] = [];
const cutLen: number[] = [];
const accAll: number[] = [], accCut: number[] = [];
const spdAll: number[] = [], spdCut: number[] = [];
let tov = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasPass = false;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const isPass = game.ballMode === "pass";
    if (isPass && !wasPass) {
      passes++;
      const from = game.passer, to = game.passTo;
      if (from && to) passLen.push(dist2D(from.pos, to.pos));
      if (from) { accAll.push(from.attr.passAcc); spdAll.push(from.attr.passSpd); }
      // リリース時、レーンに一番近い相手
      if (from && to) {
        let closest = Infinity;
        for (const d of game.players) {
          if (d.team === from.team) continue;
          const r = segPerp(from.pos.x, from.pos.z, to.pos.x, to.pos.z, d.pos.x, d.pos.z);
          if (r.t <= 0.12 || r.t >= 0.92) continue;
          closest = Math.min(closest, r.perp);
        }
        if (closest < Infinity) {
          laneGap.push(closest);
          if (closest <= LANE_W) thrownIntoLane++;
        }
      }
      const st = (game as unknown as { passSteal: { def: Player } | null }).passSteal;
      if (st && from && to) {
        cuts++;
        const { perp } = segPerp(from.pos.x, from.pos.z, to.pos.x, to.pos.z, st.def.pos.x, st.def.pos.z);
        perpAt.push(perp);
        if (perp <= LANE_W) inLane++; else closing++;
        cutLen.push(dist2D(from.pos, to.pos));
        accCut.push(from.attr.passAcc); spdCut.push(from.attr.passSpd);
      }
    }
    wasPass = isPass;
  }
  tov += game.players.reduce((s, p) => s + p.stats.tov, 0);
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`${NG} 試合（各4分）`);
console.log(`パス ${passes} 本（試合あたり ${(passes / NG).toFixed(1)} 本） / 距離 中央 ${q(passLen, .5)}m`);
console.log(`カット ${cuts} 本（試合あたり ${(cuts / NG).toFixed(2)} 本、パスの ${(cuts / Math.max(1, passes) * 100).toFixed(1)}%）`);
console.log(`  リリース時に**すでにレーンに居た** ${inLane} 本`);
console.log(`  レーンの外から走り込んだ         ${closing} 本`);
console.log(`  カットした相手のレーンからの距離 中央 ${q(perpAt, .5)}m（レーン幅 ${LANE_W}m）`);
console.log(`  カットされたパスの距離 中央 ${q(cutLen, .5)}m`);
console.log(`
リリース時にレーン(${LANE_W}m以内)へ相手が立っていたパス ${thrownIntoLane} 本`
  + `（${(thrownIntoLane / Math.max(1, passes) * 100).toFixed(1)}%）`);
console.log(`レーンに一番近い相手の距離 中央 ${q(laneGap, .5)}m  25% ${q(laneGap, .25)}m`);
const mean = (a: number[]): string => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "-";
console.log(`
パサーの能力（全パス vs カットされたパス）`);
console.log(`  P精度 全 ${mean(accAll)} / カットされた ${mean(accCut)}`);
console.log(`  P速度 全 ${mean(spdAll)} / カットされた ${mean(spdCut)}`);
console.log(`ターンオーバー 試合あたり ${(tov / NG).toFixed(1)}`);
