// リバウンドで跳ばない理由の内訳。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { REB_DEBUG } from "../src/core/looseball";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60;
const g = game as unknown as { applyRoster(): void; reset(): void };
const c = { 弾道が読めない: 0, ジャンプ不要な低さ: 0, 落下点に間に合わない: 0, まだ早い: 0, 着地硬直中: 0, 踏み切り: 0 };
const planTs: number[] = [], planHs: number[] = [];
REB_DEBUG.onEval = (p, t, h, gap, ready, lead) => {
  if (t < 0) { c.弾道が読めない++; return; }
  planTs.push(t); planHs.push(h);
  if (h <= 0.05) { c.ジャンプ不要な低さ++; return; }
  if (!ready) { c.落下点に間に合わない++; return; }
  if (t > lead + 0.03) { c.まだ早い++; return; }
  if (p.landT > 0) { c.着地硬直中++; return; }
  c.踏み切り++;
};
const NG = Number(process.env.NG ?? 4);
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) game.update(DT);
}
const tot = Object.values(c).reduce((a, b) => a + b, 0);
console.log(`リバウンド追走中の判定 ${tot} フレーム`);
for (const [k, v] of Object.entries(c)) console.log(`  ${k.padEnd(12, "　")} ${String(v).padStart(6)}  ${(v / tot * 100).toFixed(1)}%`);
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`\n解けた到達時刻 中央 ${q(planTs, .5)}秒 / 必要なジャンプ高さ 中央 ${q(planHs, .5)}m`);
