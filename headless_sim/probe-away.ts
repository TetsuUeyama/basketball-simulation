// 持ち場から離れているオフボール選手が、その時どの状態にあるか。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D, dist2DTo } from "../src/util";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);
const st = new Map<string, number>();
let n = 0, far = 0, tooOut = 0, outN = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 15 || !game.frontT) continue;
    const t = game.possession;
    const spots = game.formationSpots(t);
    const rim = game.attackFloor(t);
    for (const p of game.teamPlayers(t)) {
      if (p === game.handler) continue;
      const s = spots[p.spotIdx]; if (!s) continue;
      n++;
      const gap = dist2DTo(p.pos, s.x, s.z);
      const pr = dist2D(p.pos, rim), sr = dist2DTo(rim, s.x, s.z);
      if (pr > sr + 1.0) { tooOut++; }          // 持ち場より1m以上 外側
      if (gap < 1.8) continue;
      far++;
      const k = p.screening ? "スクリーン中"
        : p.cutting ? "カット中"
        : p.shakeOpenT > 0 ? "マーク外し中"
        : p.rooted ? "硬直(パス/シュート後)"
        : p.plantT > 0 ? "踏ん張り"
        : p.shovedT > 0 ? "押されている"
        : pr > sr + 1.0 ? "持ち場より外側で止まっている"
        : "持ち場へ移動中/その他";
      st.set(k, (st.get(k) ?? 0) + 1);
    }
    for (const p of game.teamPlayers(t)) {
      if (p === game.handler || p.spotIdx >= 5) continue;
      outN++; if (dist2D(p.pos, rim) > THREE_DIST + 1.0) tooOut += 0;
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  オフボール標本 ${n}`);
console.log(`  持ち場から1.8m以上 離れている: ${pc(far, n)}`);
console.log(`  持ち場より1m以上 外側に居る: ${pc(tooOut, n)}`);
console.log("\n■ 離れている時の状態");
[...st.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${pc(v, far)}`));
