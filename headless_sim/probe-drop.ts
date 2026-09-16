// ドロップ役のビッグがゴール下に留まっているか。守備の型ごとの役割分担も確認。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { TACTICS } from "../src/attributes";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);
const SCHEME = (process.env.SCHEME ?? "drop") as "drop" | "boxOne" | "matchup";
type A = { n: number; d: number; near: number };
const acc: Record<string, A> = { drop: { n: 0, d: 0, near: 0 }, other: { n: 0, d: 0, near: 0 } };
const modes = new Map<string, number>();
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  TACTICS[0].scheme = SCHEME; TACTICS[1].scheme = SCHEME;
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 20 || !game.frontT) continue;
    const def = 1 - game.possession;
    const protect = game.attackFloor(game.possession);   // 守るリム
    for (const d of game.teamPlayers(def)) {
      const dist = dist2D(d.pos, protect);
      const k = d.dropBig ? "drop" : "other";
      acc[k].n++; acc[k].d += dist; if (dist < 4.5) acc[k].near++;
      const m = `${d.dropBig ? "ドロップ役" : d.defMode === "zone" ? "ゾーン" : "マンマーク"}`;
      modes.set(m, (modes.get(m) ?? 0) + 1);
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  守備の型: ${SCHEME}`);
console.log("\n■ 守るリムからの距離");
for (const k of ["drop", "other"]) {
  const a = acc[k]; if (!a.n) { console.log(`  ${k}: 該当なし`); continue; }
  console.log(`  ${k === "drop" ? "ドロップ役のビッグ" : "その他の守備者"}: `
    + `平均 ${(a.d / a.n).toFixed(2)}m / ゴール下4.5m内 ${pc(a.near, a.n)} (${a.n}件)`);
}
console.log("\n■ 役割の内訳");
const tot = [...modes.values()].reduce((x, y) => x + y, 0);
[...modes.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${pc(v, tot)}`));
