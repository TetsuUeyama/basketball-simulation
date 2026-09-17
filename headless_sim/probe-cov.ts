// スクリーンのカバレッジが、相手ハンドラーの3P力でどう変わるか（チェンジング）。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 20);
const BANDS: [number, number][] = [[0, 0.76], [0.76, 0.82], [0.82, 1.01]];
const acc = new Map<string, Record<string, number>>();
let prevCov = "";
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    const c = game.screen.cov;
    if (c && c !== prevCov && game.handler) {
      const h = game.handler;
      const shoot = (h.attr.threeAcc * 0.6 + h.attr.threeRange * 0.4) / 100;
      const [x, y] = BANDS.find(([a, b]) => shoot >= a && shoot < b) ?? BANDS[0];
      const k = `${x}〜${y}`;
      if (!acc.has(k)) acc.set(k, { drop: 0, show: 0, switch: 0, n: 0 });
      const e = acc.get(k)!; e[c]++; e.n++;
    }
    prevCov = c;
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  ハンドラーの3P力（L精度0.6+L速度0.4）別のカバレッジ`);
for (const [x, y] of BANDS) {
  const e = acc.get(`${x}〜${y}`); if (!e) continue;
  console.log(`  3P力 ${x}〜${y}: ドロップ ${pc(e.drop, e.n)} / ショー ${pc(e.show, e.n)} / スイッチ ${pc(e.switch, e.n)}  (${e.n}件)`);
}
