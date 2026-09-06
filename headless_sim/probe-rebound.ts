// リバウンドの確保が、確認画面と同じキャッチの形になるかを見る。
// 経路: ballMode="loose" → raiseAirborne / contestBall → grabPose → catchBallHands
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
const { poseHands } = await import("../src/core/poses");
const { catchBall } = await import("../src/animation/action/catch");
const { HAND_PTS, BALL_R } = await import("../src/animation/action/palm");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
for (const t of [0, 1]) for (let i = 0; i < game.roster[t].length; i++) {
  game.roster[t][i].pos.set(40 + i, 0, 40 + t * 5);
}
const p = game.roster[0][0];
const K = p.height / 1.804;

/** 当たる点のうち一番ボールに近いもの（体の枠での 横・高さ）と、貫通量。 */
function grip(b: Vector3): string {
  const th = p.root.rotation.y;
  const rx = Math.cos(th), rz = -Math.sin(th);
  const out: string[] = [];
  let pen = 0;
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never)!;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    let near = new Vector3(), nd = Infinity;
    for (const q of HAND_PTS[bn]) {
      const w = Vector3.TransformCoordinates(q.scale(K), m);
      const d = Vector3.Distance(w, b);
      if (d < nd) { nd = d; near = w; }
      pen = Math.max(pen, BALL_R - d);
    }
    const v = near.subtract(b);
    out.push(`${((v.x * rx + v.z * rz) * 1000).toFixed(0).padStart(5)},${(v.y * 1000).toFixed(0).padStart(5)}`);
  }
  const lat = out.map((o) => Number(o.split(",")[0]));
  return `${out.join("  ")}  間隔 ${Math.abs(lat[0] - lat[1]).toFixed(0).padStart(4)}mm`
    + `  貫通 ${pen > 0.002 ? "★" + (pen * 1000).toFixed(0) + "mm" : "なし"}`;
}

console.log("リバウンドの確保（ballMode=loose, looseIsRebound）");
console.log("ボールの高さ  奥行き   左右の当たる点(横,高)                間隔      貫通");
game.ballMode = "loose";
(game as unknown as { looseIsRebound: boolean }).looseIsRebound = true;
for (const [by, dz] of [[1.95, 0.15], [1.85, 0.15], [1.70, 0.20], [1.55, 0.25], [1.30, 0.25]] as [number, number][]) {
  p.stand(); p.pos.set(0, 0, 0); p.setNumberSide(1); p.root.rotation.y = 0;
  const th = p.root.rotation.y;
  const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
  const b = new Vector3(fx * dz, by, fz * dz);
  for (let i = 0; i < 300; i++) {
    game.ball.pos.copyFrom(b);
    p.lastDt = 1 / 60; p.sync(); poseHands(game);
  }
  console.log(`  ${by.toFixed(2)}m  前 ${dz.toFixed(2)}m   ${grip(b)}  ${p.catchTwo ? "両手" : "片手"} 高さ${p.catchHi.toFixed(2)} 横${p.catchSide.toFixed(2)}`);
}

console.log("\n同じ位置を確認画面の経路（catchBall を直接）で");
for (const [by, dz] of [[1.95, 0.15], [1.85, 0.15], [1.70, 0.20], [1.55, 0.25], [1.30, 0.25]] as [number, number][]) {
  p.stand(); p.pos.set(0, 0, 0); p.setNumberSide(1); p.root.rotation.y = 0;
  const th = p.root.rotation.y;
  const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
  const b = new Vector3(fx * dz, by, fz * dz);
  for (let i = 0; i < 300; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  console.log(`  ${by.toFixed(2)}m  前 ${dz.toFixed(2)}m   ${grip(b)}  ${p.catchTwo ? "両手" : "片手"} 高さ${p.catchHi.toFixed(2)} 横${p.catchSide.toFixed(2)}`);
}
