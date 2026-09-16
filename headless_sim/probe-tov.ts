// ターンオーバーの発生源を分類する。ハンドラーのドリブル中の喪失がどれだけか。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D, MOVE_TRACE } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 10);
MOVE_TRACE.on = false;
const why = new Map<string, number>();
const byAcc = new Map<string, { tov: number; frames: number }>();
const BANDS: [number, number][] = [[0, 70], [70, 75], [75, 80], [80, 85], [85, 90], [90, 101]];
const bk = (v: number) => { const [a, b] = BANDS.find(([x, y]) => v >= x && v < y) ?? BANDS[0]; return `${a}〜${b}`; };
const at = (v: number) => { const k = bk(v); if (!byAcc.has(k)) byAcc.set(k, { tov: 0, frames: 0 }); return byAcc.get(k)!; };
let tot = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const all = [...game.roster[0], ...game.roster[1]];
  const prev = new Map(all.map((p) => [p, p.stats.tov]));
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const h0 = game.handler;
    const wasDribbling = !!h0 && game.ballMode === "held";
    const beaten = !!h0 && (h0.beatenT > 0 || h0.powerT > 0);
    const nd = h0 ? game.nearestDefenderDist(h0) : 9;
    if (h0) at(h0.attr.dribbleAcc).frames++;
    game.update(DT);
    for (const p of all) {
      const was = prev.get(p) ?? 0;
      if (p.stats.tov <= was) continue;
      prev.set(p, p.stats.tov);
      tot++;
      at(p.attr.dribbleAcc).tov++;
      const k = p !== h0 ? "ハンドラー以外(パス等)"
        : !wasDribbling ? "保持していない状態"
        : beaten ? (nd < 1.2 ? "ドライブ中・守備に密着して喪失" : "ドライブ中・離れていて喪失")
        : (nd < 1.2 ? "ドリブル中・守備に密着して喪失" : "ドリブル中・離れていて喪失");
      why.set(k, (why.get(k) ?? 0) + 1);
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  ターンオーバー ${tot}件（1チーム1試合 ${(tot / NG / 2).toFixed(1)}）`);
console.log("\n■ 発生源");
[...why.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v} (${pc(v, tot)})`));
console.log("\n■ ドリブル精度(dribbleAcc)別");
for (const [a, b] of BANDS) {
  const v = byAcc.get(`${a}〜${b}`); if (!v) continue;
  console.log(`  ${a}〜${b}: TOV ${v.tov} / 保持 ${v.frames}フレーム`
    + ` → 1000フレームあたり ${(v.tov / Math.max(1, v.frames) * 1000).toFixed(2)}`);
}
