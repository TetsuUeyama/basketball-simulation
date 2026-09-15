// 中央(|x|<1.5)を走っている選手は、どの分岐から命令を受けているか。
// あわせて「ワイドレーン(|x|>4.0)に何人いるか」を数える。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { MOVE_TRACE, MOVE_LOG } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 3);

const siteOff = new Map<string, number>(), siteDef = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
// ワイドレーン人数の分布（攻撃側5人のうち |x|>4.0 が何人か）
const wide = [0, 0, 0, 0, 0, 0];
let wideN = 0;

MOVE_TRACE.site = true;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    MOVE_TRACE.on = (i % 12 === 0);   // スタック取得は重いので間引く
    if (MOVE_TRACE.on) MOVE_LOG.clear();
    game.update(DT);
    const off = game.possession;
    if (MOVE_TRACE.on) for (let t = 0; t < 2; t++) for (const p of game.teamPlayers(t)) {
      if (Math.hypot(p.velX, p.velZ) <= 2.0) continue;
      if (Math.abs(p.pos.x) >= 1.5) continue;
      const a = MOVE_LOG.get(p.pos); if (!a || !a.length) continue;
      let best = a[0]; for (const m of a) if (m.step > best.step) best = m;
      bump(t === off ? siteOff : siteDef, best.site || "?");
    }
    if (i % 10 === 0 && game.frontT) {
      wide[game.teamPlayers(off).filter((q) => Math.abs(q.pos.x) > 4.0).length]++;
      wideN++;
    }
  }
}
MOVE_TRACE.on = false;
const show = (nm: string, m: Map<string, number>) => {
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${nm}（中央 |x|<1.5 を 2m/s超で移動、計 ${tot} 件）:`);
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([k, v]) => console.log(`  ${k}: ${v} (${(v / Math.max(1, tot) * 100).toFixed(1)}%)`));
};
console.log(`${NG}試合`);
show("攻撃側", siteOff);
show("守備側", siteDef);
console.log(`\n攻撃5人のうち ワイドレーン(|x|>4.0) に居る人数の分布（${wideN}サンプル）:`);
wide.forEach((v, i) => console.log(`  ${i}人: ${(v / Math.max(1, wideN) * 100).toFixed(1)}%`));
