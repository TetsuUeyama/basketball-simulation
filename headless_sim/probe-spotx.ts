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
import { MOVE_TRACE, MOVE_LOG } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
let n = 0, sumP = 0, sumS = 0, atSpot = 0;
let churn = 0, churnFrames = 0;
const br = new Map<string, number>(), bx = new Map<string, number>();
const prevSpot = new Map<Player, number>();
const cnt: Record<number, { n: number; px: number; sx: number; pr: number; sr: number; out: number }> = {};
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    MOVE_TRACE.on = (i % 12 === 0); MOVE_TRACE.site = true;
    if (MOVE_TRACE.on) MOVE_LOG.clear();
    game.update(DT);
    if (MOVE_TRACE.on && game.frontT) {
      for (const q of game.teamPlayers(game.possession)) {
        if (q === game.handler) continue;
        const a = MOVE_LOG.get(q.pos); if (!a || !a.length) { br.set("(命令なし)", (br.get("(命令なし)") ?? 0) + 1); continue; }
        let b = a[0]; for (const m of a) if (m.step > b.step) b = m;
        const k = b.site || "?";
        br.set(k, (br.get(k) ?? 0) + 1);
        bx.set(k, (bx.get(k) ?? 0) + Math.abs(q.pos.x));
      }
    }
    if (game.frontT) {
      churnFrames++;
      for (const q of game.teamPlayers(game.possession)) {
        const pv = prevSpot.get(q);
        if (pv !== undefined && pv !== q.spotIdx) churn++;
        prevSpot.set(q, q.spotIdx);
      }
    }
    if (i % 15 || !game.frontT) continue;
    const t = game.possession;
    const spots = game.formationSpots(t);
    for (const p of game.teamPlayers(t)) {
      if (p === game.handler || p.cutting || p.screening) continue;
      const s = spots[p.spotIdx]; if (!s) continue;
      n++; sumP += Math.abs(p.pos.x); sumS += Math.abs(s.x);
      if (dist2DTo(p.pos, s.x, s.z) < 1.8) atSpot++;
      const c = cnt[p.spotIdx] ?? (cnt[p.spotIdx] = { n: 0, px: 0, sx: 0, pr: 0, sr: 0, out: 0 });
      c.n++; c.px += Math.abs(p.pos.x); c.sx += Math.abs(s.x);
      const rim = game.attackFloor(t);
      const pr = dist2DTo(rim, p.pos.x, p.pos.z), sr = dist2DTo(rim, s.x, s.z);
      c.pr += pr; c.sr += sr; if (pr > 6.75) c.out++;
    }
  }
}
console.log(`${NG}試合  オフボール攻撃 ${n}サンプル`);
console.log(`  実際の |x| 平均 ${(sumP / n).toFixed(2)}m / 割当スポットの |x| 平均 ${(sumS / n).toFixed(2)}m`);
console.log(`  持ち場から1.8m以内に居る割合: ${(atSpot / n * 100).toFixed(1)}%`);
console.log(`  スポット変更: ${churn}回 / 選手1人あたり ${(churn / Math.max(1, churnFrames) * 60 / 5).toFixed(2)} 回/秒`);
console.log("\nスポット別:");
for (const k of Object.keys(cnt).map(Number).sort((a, b) => a - b)) {
  const c = cnt[k];
  console.log(`  spot${k}: ${String(c.n).padStart(5)}件 / リムから 実際 ${(c.pr / c.n).toFixed(2)}m ・定義 ${(c.sr / c.n).toFixed(2)}m / 3Pラインより外 ${(c.out / c.n * 100).toFixed(1)}%`);
}
