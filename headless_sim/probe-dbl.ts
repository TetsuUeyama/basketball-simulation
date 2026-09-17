// (B) ダブルチーム: 発動条件が現実的か。ゴール下で決めた得点の分布と、実際に挟んだ頻度。
import "./stubs";
let _s = 0;
const setSeed = (v: number): void => { _s = v >>> 0; };
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { DOUBLE_TEAM_PTS } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const SEEDS = (process.env.SEEDS ?? "0x9e3779b9,0x2545f491,0x85ebca6b").split(",").map((v) => Number(v) >>> 0);

const maxRim: number[] = [];      // 各試合・各チームの「ゴール下得点」の最大値
let armed = 0, engaged = 0, live = 0;
for (const seed of SEEDS) {
  for (let gi = 0; gi < NG; gi++) {
    setSeed((seed + gi * 0x9e3779b1) >>> 0);
    clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
    g.applyRoster(); g.reset();
    for (let i = 0; i < 60 * 60 * 8; i++) {
      game.update(DT);
      if (!game.frontT || game.ballMode !== "held") continue;
      live++;
      if (game.doubleTarget) armed++;
      if (game.doubleTarget && game.doubler && game.handler === game.doubleTarget
          && dist2D(game.doubler.pos, game.doubleTarget.pos) < 1.8) engaged++;
    }
    for (const t of [0, 1]) {
      let m = 0;
      for (const p of game.roster[t]) m = Math.max(m, p.rimPts);
      maxRim.push(m);
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(2) + "%";
// ⚠️ これが狙いの指標。「1人で抑え切れずゴール下から量産される」を直接測る。
const mean = maxRim.reduce((s2, v) => s2 + v, 0) / Math.max(1, maxRim.length);
console.log("★ ゴール下最多得点の平均: " + mean.toFixed(2) + "点/チーム");
maxRim.sort((a, b) => a - b);
const q = (f: number) => maxRim[Math.floor((maxRim.length - 1) * f)];
console.log(`${NG * SEEDS.length}試合  しきい値 DOUBLE_TEAM_PTS = ${DOUBLE_TEAM_PTS}点`);
console.log(`\n■ 1チームの中で「ゴール下で最も点を取った選手」の得点（${maxRim.length}件）`);
console.log(`  最小 ${q(0)} / 25% ${q(0.25)} / 中央 ${q(0.5)} / 75% ${q(0.75)} / 最大 ${q(1)}`);
for (const th of [4, 6, 8, 10, 12]) {
  console.log(`  ${th}点以上に達したチーム: ${pc(maxRim.filter((v) => v >= th).length, maxRim.length)}`);
}
console.log(`\n■ ダブルチーム  対象が決まっているフレーム ${pc(armed, live)} / 実際に挟んだ ${pc(engaged, live)}`);
