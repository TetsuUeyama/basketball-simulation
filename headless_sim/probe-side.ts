// 高いボールを、下から抱えず横から挟んでいるかを見る。
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
const shY = p.pos.y + p.vox!.shoulder.y;
console.log("当たる点がボール中心から見てどちらにあるか（体の枠。横＋が体の右）");
console.log("位置              左手(横,高)        右手(横,高)     左右の間隔  交差");
for (const [dy, note] of [
  [0.55, "真上（頭より上）"], [0.34, "頭の上"], [0.15, "顔の前"],
  [0.0, "肩の高さ"], [-0.15, "胸の高さ"], [-0.35, "腰の高さ"],
] as [number, string][]) {
  p.stand();
  const th = p.root.rotation.y;
  const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
  const b = new Vector3(p.pos.x + fx * 0.18, shY + dy, p.pos.z + fz * 0.18);
  for (let i = 0; i < 300; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  const rx = Math.cos(th), rz = -Math.sin(th);   // 仮想の +X（体の右）
  const at: Record<string, Vector3> = {};
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never)!;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    let best = HAND_PTS[bn][0], bestD = Infinity;
    for (const q of HAND_PTS[bn]) {
      const w = Vector3.TransformCoordinates(q.scale(K), m);
      const d = Vector3.Distance(w, b);
      if (d < bestD) { bestD = d; best = w as Vector3; }
    }
    at[bn] = (best as Vector3).subtract(b);
  }
  const lat = (v: Vector3): number => (v.x * rx + v.z * rz) * 1000;
  const L = at.LeftHand, R = at.RightHand;
  // 仮想の左手はボクセルの右側にいるので、番号側で見え方が変わる。体の枠で見る。
  const cross = lat(L) * lat(R) > 0 ? "★同じ側" : "なし";
  console.log(`  ${note.padEnd(16)} ${lat(L).toFixed(0).padStart(5)},${(L.y * 1000).toFixed(0).padStart(5)}`
    + `   ${lat(R).toFixed(0).padStart(5)},${(R.y * 1000).toFixed(0).padStart(5)}`
    + `   ${Math.abs(lat(L) - lat(R)).toFixed(0).padStart(6)}mm  ${cross}`);
}
console.log(`\n※ 横の間隔が ${(BALL_R * 2000).toFixed(0)}mm 前後なら、両手がボールの左右に付いている。`);
