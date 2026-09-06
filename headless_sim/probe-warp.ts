// ボールが1フレームで飛ぶ（ワープする）場面を数える。
import "./stubs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2DTo } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60;
const g = game as unknown as { applyRoster(): void; reset(): void };
const prev = new Vector3();
let warps = 0, maxWarp = 0, frames = 0;
const byMode = new Map<string, number>();
const nearest: number[] = [];   // カットの守備者がボールへ一番近づいた距離
let cur = Infinity, inPass = false;
for (let gi = 0; gi < 4; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 4);
  g.applyRoster(); g.reset();
  prev.copyFrom(game.ball.pos);
  let prevMode = game.ballMode;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const ps = (game as unknown as { passSteal: { def: Player } | null }).passSteal;
    if (game.ballMode === "pass" && ps?.def) {
      if (!inPass) { inPass = true; cur = Infinity; }
      cur = Math.min(cur, dist2DTo(game.ball.pos, ps.def.pos.x, ps.def.pos.z));
    } else if (inPass) { inPass = false; if (isFinite(cur)) nearest.push(cur); }
    game.update(DT);
    frames++;
    const d = Vector3.Distance(prev, game.ball.pos);
    if (d > 0.8) {
      warps++; maxWarp = Math.max(maxWarp, d);
      const key = `${prevMode} → ${game.ballMode}`;
      byMode.set(key, (byMode.get(key) ?? 0) + 1);
    }
    prev.copyFrom(game.ball.pos);
    prevMode = game.ballMode;
  }
}
nearest.sort((x, y) => x - y);
console.log(`4試合・${frames.toLocaleString()} フレーム`);
console.log(`  ボールが1フレームで 0.8m 以上飛んだ回数 ${warps}（最大 ${maxWarp.toFixed(2)}m）`);
console.log("  内訳（飛ぶ直前 → 直後 のボールの状態）:");
for (const [k, v] of [...byMode].sort((x, y) => y[1] - x[1])) console.log(`    ${k.padEnd(24)} ${v}`);
if (nearest.length) {
  console.log(`  カットの守備者がボールへ一番近づいた距離: ${nearest.length} 本  ` +
    `中央 ${nearest[nearest.length >> 1].toFixed(2)}m / 最短 ${nearest[0].toFixed(2)}m`);
}

// カットが成立しているか（パス中に持ち主が入れ替わる／ルーズになる）と、その瞬間の飛び
console.log("");
{
  let picked = 0, deflected = 0; const jump: number[] = [];
  for (let gi = 0; gi < 4; gi++) {
    clubTeam(0, gi + 2); clubTeam(1, gi + 6);
    g.applyRoster(); g.reset();
    let prevMode = game.ballMode, prevPoss = game.possession;
    const pb = new Vector3(); pb.copyFrom(game.ball.pos);
    for (let i = 0; i < 60 * 60 * 4; i++) {
      game.update(DT);
      if (prevMode === "pass") {
        if (game.ballMode === "held" && game.possession !== prevPoss) {
          picked++; jump.push(Vector3.Distance(pb, game.ball.pos));
        } else if (game.ballMode === "loose") {
          deflected++; jump.push(Vector3.Distance(pb, game.ball.pos));
        }
      }
      pb.copyFrom(game.ball.pos);
      prevMode = game.ballMode; prevPoss = game.possession;
    }
  }
  jump.sort((a, b) => a - b);
  console.log(`カットで奪った ${picked} 回 / はじいた ${deflected} 回`);
  if (jump.length) {
    console.log(`  その瞬間のボールの移動 中央 ${jump[jump.length >> 1].toFixed(2)}m`
      + ` / 最大 ${jump[jump.length - 1].toFixed(2)}m`);
  }
}
