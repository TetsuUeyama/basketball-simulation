// パスの飛距離の分布。長すぎるパス（コート横断）がどれだけ出ているか。
import "./stubs";
let _s = 0x9e3779b9;
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
const NG = Number(process.env.NG ?? 12);

const dist: number[] = [];
const byStyle: Record<string, number[]> = { chest: [], bounce: [], overhead: [], jump: [] };
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    game.update(DT);
    if (mode !== "pass" && game.ballMode === "pass") {
      const d = Math.hypot(game.passCatch.x - game.passFrom.x, game.passCatch.z - game.passFrom.z);
      dist.push(d);
      (byStyle[game.passStyle] ??= []).push(d);
    }
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(1) : "-";
const over = (a: number[], m: number): string =>
  (a.filter((x) => x > m).length / Math.max(1, a.length) * 100).toFixed(0) + "%";
console.log(`${NG} 試合  パス ${dist.length} 本`);
console.log(`  飛距離 中央 ${q(dist, .5)}m / 75% ${q(dist, .75)}m / 90% ${q(dist, .9)}m / 最長 ${q(dist, 1)}m`);
console.log(`  8m超 ${over(dist, 8)} / 10m超 ${over(dist, 10)} / 12m超 ${over(dist, 12)}`);
for (const [k, a] of Object.entries(byStyle)) {
  if (!a.length) continue;
  console.log(`  ${k.padEnd(9)} ${String(a.length).padStart(3)}本  中央 ${q(a, .5)}m / 90% ${q(a, .9)}m / 最長 ${q(a, 1)}m`);
}
console.log("※ 実際のバスケット: ほとんどのパスは 3〜8m。10m超は速攻のアウトレット等に限られる。");
