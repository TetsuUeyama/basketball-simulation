// オンボール守備の間合い: 実際にハンドラーとマークマンが何m離れているか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);

const all: number[] = [];
const byDepth: Record<string, number[]> = { "リム〜3m": [], "3〜6m": [], "6〜9m": [], "9m〜": [] };
const nearest: number[] = [];
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const h = game.handler;
    if (!h || game.ballMode !== "held") continue;
    const man = game.teamPlayers(1 - h.team)[h.slot];   // 担当守備者
    if (!man) continue;
    const d = dist2D(man.pos, h.pos);
    all.push(d);
    const dh = dist2D(h.pos, game.attackFloor(h.team));
    const k = dh < 3 ? "リム〜3m" : dh < 6 ? "3〜6m" : dh < 9 ? "6〜9m" : "9m〜";
    byDepth[k].push(d);
    nearest.push(game.nearestDefenderDist(h));
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`${NG} 試合  ボール保持中の ${all.length} フレーム`);
console.log(`担当守備者との距離  中央 ${q(all, .5)}m  25% ${q(all, .25)}m  10% ${q(all, .1)}m  75% ${q(all, .75)}m`);
for (const [k, a] of Object.entries(byDepth)) {
  console.log(`  ${k}\t中央 ${q(a, .5)}m  25% ${q(a, .25)}m  10% ${q(a, .1)}m  (${a.length} フレーム)`);
}
console.log(`最寄り守備者との距離 中央 ${q(nearest, .5)}m  25% ${q(nearest, .25)}m  10% ${q(nearest, .1)}m`);
console.log(`※ 実際のバスケット: オンボールは概ね 0.9〜1.5m（腕一本＋）。0.6m 以下は密着/ポスト。`);
