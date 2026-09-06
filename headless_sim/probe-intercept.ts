// インターセプトの選手が、キャッチと同じ形（手のひらがボール表面）になっているかを見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = false;
import { clubTeam } from "../src/roster";
const { startRawPreload } = await import("../src/objects/player/player-raw");
const { syncAll } = await import("../src/core/visuals");
const { HAND_PTS, BALL_R } = await import("../src/animation/action/palm");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
const DT = 1 / 60;
/** その選手の手のうち、ボールに一番近い点までの距離(mm)。 */
function nearHand(p: Player, b: Vector3): number {
  const K = p.height / 1.804;
  let nd = Infinity;
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never);
    if (!n) continue;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    for (const q of HAND_PTS[bn]) {
      nd = Math.min(nd, Vector3.Distance(Vector3.TransformCoordinates(q.scale(K), m), b));
    }
  }
  return nd * 1000;
}
// パス1本ごとに「手がボールへ一番近づいた距離」を記録する
const recvMin: number[] = [], stealMin: number[] = [];
let curRecv = Infinity, curSteal = Infinity, inPass = false, stealSeen = 0;
for (let gi = 0; gi < 3; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 4);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 3; i++) {
    game.update(DT); syncAll(game);
    const ps = (game as unknown as { passSteal: { def: Player } | null }).passSteal;
    if (game.ballMode === "pass") {
      if (!inPass) { inPass = true; curRecv = Infinity; curSteal = Infinity; }
      if (game.passTo?.vox) curRecv = Math.min(curRecv, nearHand(game.passTo, game.ball.pos));
      if (ps?.def?.vox) { stealSeen++; curSteal = Math.min(curSteal, nearHand(ps.def, game.ball.pos)); }
    } else if (inPass) {
      inPass = false;
      if (isFinite(curRecv)) recvMin.push(curRecv);
      if (isFinite(curSteal)) stealMin.push(curSteal);
    }
  }
}
const avg = (a2: number[]): string => a2.length ? (a2.reduce((x, y) => x + y, 0) / a2.length).toFixed(0) : "-";
const med = (a2: number[]): string => { if (!a2.length) return "-"; const c = [...a2].sort((x, y) => x - y);
  return c[c.length >> 1].toFixed(0); };
console.log(`ボール半径 ${(BALL_R * 1000).toFixed(0)}mm（手が表面に付いていれば 120mm 前後）`);
console.log(`  パス ${recvMin.length} 本ぶん。1本ごとに「手がボールへ一番近づいた距離」を見る。`);
console.log(`  受け手           平均 ${avg(recvMin)}mm  中央 ${med(recvMin)}mm`);
console.log(`  カットに跳ぶ守備者 ${stealMin.length} 本（延べ ${stealSeen} フレーム）  平均 ${avg(stealMin)}mm  中央 ${med(stealMin)}mm`);
