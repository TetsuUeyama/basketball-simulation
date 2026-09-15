// ハンドラーが止まった時に、オフボール攻撃が止まる理由を分類する。
//  (a) 命令なし  (b) 命令はあるが行き先が今いる場所  (c) 歩幅がほぼ0  (d) それ以外
// 呼び出し元はソースマップで実ファイル:行に解決する。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2DTo, MOVE_TRACE, MOVE_LOG } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 3);

let stillFrames = 0, offN = 0, offStop = 0;
const why = new Map<string, number>();
const siteStay = new Map<string, number>();   // 「その場へ動け」を出した呼び出し元
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
let postStop = 0, postN = 0, perimStop = 0, perimN = 0;

MOVE_TRACE.site = true;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const h = game.handler;
    const watch = !!h && h.stillT > 0.5 && game.frontT;
    MOVE_TRACE.on = watch;
    if (watch) MOVE_LOG.clear();
    game.update(DT);
    if (!watch || !game.handler) continue;
    stillFrames++;
    for (const p of game.teamPlayers(game.possession)) {
      if (p === game.handler) continue;
      offN++;
      const post = p.spotIdx >= 5;
      if (post) postN++; else perimN++;
      if (p.curSpd >= 0.4) continue;
      offStop++;
      if (post) postStop++; else perimStop++;
      const a = MOVE_LOG.get(p.pos) ?? [];
      if (p.rooted) { bump(why, "rooted(パス/シュート硬直)"); continue; }
      if (!a.length) { bump(why, "(a) 命令なし"); continue; }
      // 一番大きな歩幅の命令を代表にする
      let best = a[0];
      for (const m of a) if (m.step > best.step) best = m;
      const far = dist2DTo(p.pos, best.tx, best.tz);
      if (far < 0.05) { bump(why, "(b) 行き先が今いる場所"); bump(siteStay, best.site || "?"); }
      else if (best.step < 0.002) { bump(why, "(c) 歩幅がほぼ0(加速できていない)"); bump(siteStay, best.site || "?"); }
      else bump(why, `(d) その他 距離${far.toFixed(2)}m 歩幅${best.step.toFixed(4)}`);
    }
  }
}
MOVE_TRACE.on = false;
const pc = (n: number, d: number) => (n / Math.max(1, d) * 100).toFixed(1) + "%";
console.log(`${NG}試合  ハンドラー停止中のフレーム ${stillFrames}`);
console.log(`  オフボール攻撃の停止率: ${pc(offStop, offN)} (${offStop}/${offN})`);
console.log(`    ポスト(spotIdx>=5): ${pc(postStop, postN)} (${postStop}/${postN})`);
console.log(`    ペリメーター:       ${pc(perimStop, perimN)} (${perimStop}/${perimN})`);
console.log("\n止まっている理由の内訳:");
[...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log(`  ${k}: ${v} (${pc(v, offStop)})`));
console.log("\n「その場へ動け」を出していた呼び出し元:");
[...siteStay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([k, v]) => console.log(`  ${k}: ${v}`));
