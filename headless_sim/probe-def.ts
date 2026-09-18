// 守備の緩さを測る。①担当との距離 ②ペイント/リム下の守備人数 ③マンとゾーンの比較。
// team0 = マンマーク固定 / team1 = ゾーン固定 にして、同じ試合の中で両方を見る。
import "./stubs";
let _s = 0;
const setSeed = (v: number): void => { _s = v >>> 0; };
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST } from "../src/config";
import { TACTICS } from "../src/attributes";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b").split(",").map((v) => Number(v) >>> 0);

type Rec = { zone: boolean; gap: number; mRim: number; acc: number };
const marks: Rec[] = [];
const paint: { zone: boolean; n: number; rim: number }[] = [];
const post: { zone: boolean; gap: number; rim: number }[] = [];
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    // team0 は必ずマン、team1 は必ずゾーン
    TACTICS[0].defense.zone = 0; TACTICS[0].defense.press = 0;
    TACTICS[1].defense.zone = 1; TACTICS[1].defense.press = 0;
    for (let i = 0; i < 60 * 60 * 8; i++) {
      game.update(DT);
      if (!game.frontT || i % 6) continue;
      const off = game.possession, def = 1 - off;
      const zone = def === 1;
      const rim = game.attackFloor(off);
      // 担当との距離（ハンドラー以外）
      for (const o of game.teamPlayers(off)) {
        if (o === game.handler) continue;
        let best = 99;
        for (const d of game.teamPlayers(def)) best = Math.min(best, dist2D(o.pos, d.pos));
        marks.push({ zone, gap: best, mRim: dist2D(o.pos, rim),
          acc: Math.max(o.attr.midAcc, o.attr.threeAcc) });
      }
      // ⚠️ ゴール下の主役（ポストアンカー）だけを見る。これが「ゴール下を守れているか」の本命。
      const pa = game.postAnchor(off);
      if (pa && pa !== game.handler) {
        let pb = 99;
        for (const d of game.teamPlayers(def)) pb = Math.min(pb, dist2D(pa.pos, d.pos));
        post.push({ zone, gap: pb, rim: dist2D(pa.pos, rim) });
      }
      // ペイント(リムから4m)とリム下(2.5m)の守備人数
      let n = 0, r = 0;
      for (const d of game.teamPlayers(def)) {
        const dr = dist2D(d.pos, rim);
        if (dr < 4.0) n++;
        if (dr < 2.5) r++;
      }
      paint.push({ zone, n, rim: r });
    }
  }
}
// ⚠️ 平均は外れ値（カットで一瞬だけリム下を通過した選手など）に強く引かれる。中央値で見る。
const avg = (a: number[]) => a.length
  ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)].toFixed(2) : "-";
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
for (const z of [false, true]) {
  const m = marks.filter((r) => r.zone === z);
  const p = paint.filter((r) => r.zone === z);
  console.log(`\n■ ${z ? "ゾーン" : "マンマーク"}（${m.length}サンプル）`);
  console.log(`  最寄り守備との距離 平均 ${avg(m.map((r) => r.gap))}m / 2m超フリー ${pc(m.filter((r) => r.gap > 2).length, m.length)}`);
  for (const [lo, hi, nm] of [[0, 3, "リム下(0〜3m)"], [3, THREE_DIST, "中(3〜6.75m)"], [THREE_DIST, 99, "アークの外"]] as [number, number, string][]) {
    const a = m.filter((r) => r.mRim >= lo && r.mRim < hi);
    if (!a.length) continue;
    console.log(`    ${nm}: 平均 ${avg(a.map((r) => r.gap))}m / 2m超フリー ${pc(a.filter((r) => r.gap > 2).length, a.length)}`);
  }
  for (const [lo, hi] of [[0, 70], [70, 80], [80, 101]]) {
    const a = m.filter((r) => r.acc >= lo && r.acc < hi);
    if (!a.length) continue;
    console.log(`    シュート精度 ${lo}-${hi}: 平均 ${avg(a.map((r) => r.gap))}m`);
  }
  const po = post.filter((r) => r.zone === z);
  const poIn = po.filter((r) => r.rim < 4.5);   // 本当にゴール下に居る時だけ
  console.log(`  ポストアンカーへの最寄り守備 中央 ${avg(po.map((r) => r.gap))}m`
    + ` / ゴール下(4.5m内)に居る時 ${avg(poIn.map((r) => r.gap))}m`
    + ` / その時2m超フリー ${pc(poIn.filter((r) => r.gap > 2).length, poIn.length)}`);
  console.log(`  ペイント(4m内)の守備人数 中央 ${avg(p.map((r) => r.n))} / リム下(2.5m内) ${avg(p.map((r) => r.rim))}`);
  console.log(`  リム下が**0人**のフレーム: ${pc(p.filter((r) => r.rim === 0).length, p.length)}`);
}
