// 手がボールを貫通していないかを測る。手の各点（中指の付け根・指先など）が
// ボール中心から半径 120mm 以上にあれば貫通していない。
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
import { Player } from "../src/objects/player/player";
Player.HEADLESS = false;
import { ROSTER } from "../src/roster";
import "../src/objects/player/player-state";
import "../src/objects/player/player-query";
import "../src/objects/player/player-roster";
import "../src/objects/player/player-visual";
import "../src/animation/basic/arms";
import "../src/animation/basic/torso";
import "../src/animation/action/dribble";
import "../src/animation/action/guard";
import "../src/animation/action/hold";
import "../src/animation/action/locomotion";
import "../src/animation/action/reach";
import "../src/animation/action/reach-ik";
import "../src/animation/action/screen";
import "../src/animation/action/shoot";
import "../src/animation/action/sit";
import "../src/animation/reaction/bench-idle";
import "../src/animation/reaction/defwin";
import "../src/animation/reaction/dejected";
import "../src/animation/reaction/foul-react";
import "../src/move/basic/jump";
import "../src/move/basic/run";
import "../src/move/basic/turn";
const { startRawPreload } = await import("../src/objects/player/player-raw");
const { catchBall } = await import("../src/animation/action/catch");
const { HAND_PTS, BALL_R } = await import("../src/animation/action/palm");
await startRawPreload();
const scene = new Scene(new NullEngine());
const p = new Player(scene, 0, 0, ROSTER[0][0]);
p.pos.set(0, 0, 0); p.resetFacing(); p.stand(); p.clipOverride = "idle"; p.lastDt = 1 / 60;
const K = p.height / 1.804;
const NAMES = ["中指の付け根", "中指の第2関節", "中指の先", "人差し指の先", "小指の先", "親指の先"];

const shY = p.pos.y + p.vox!.shoulder.y;
console.log(`ボール半径 ${(BALL_R * 1000).toFixed(0)}mm。手の各点がこれ以上なら貫通していない。`);
console.log("位置        手      最短の点            距離   めり込み");
for (const [dy, dz, note] of [
  [0.34, 0.10, "頭の上"], [0.15, 0.25, "顔の前"], [-0.15, 0.30, "胸の高さ"], [-0.35, 0.20, "腰の高さ"],
] as [number, number, string][]) {
  p.stand();
  const b = new Vector3(0, shY + dy, -dz * p.numberSide);
  for (let i = 0; i < 300; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never)!;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    let best = 0, bestD = Infinity;
    for (let i = 0; i < HAND_PTS[bn].length; i++) {
      const w = Vector3.TransformCoordinates(HAND_PTS[bn][i].scale(K), m);
      const d = Vector3.Distance(w, b);
      if (d < bestD) { bestD = d; best = i; }
    }
    const pen = BALL_R - bestD;
    console.log(`  ${note.padEnd(8)} ${bn === "LeftHand" ? "左" : "右"}  ${NAMES[best].padEnd(14)}`
      + ` ${(bestD * 1000).toFixed(0).padStart(4)}mm  `
      + (pen > 0.002 ? `★${(pen * 1000).toFixed(0)}mm 貫通` : "なし"));
  }
}
