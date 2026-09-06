// パスを出した直後（＝手の狙いが消えた瞬間）に、手が小刻みに動かないかを測る。
// 試合はランダムで比較にならないので、選手1人を決まった手順で動かす。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Quaternion } from "@babylonjs/core";
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
await startRawPreload();
const scene = new Scene(new NullEngine());
const p = new Player(scene, 0, 0, ROSTER[0][0]);
p.pos.set(0, 0, 0); p.resetFacing(); p.stand(); p.clipOverride = "idle"; p.lastDt = 1 / 60;
const shY = p.pos.y + p.vox!.shoulder.y;
const ball = new Vector3(0, shY - 0.1, -0.3 * p.numberSide);

const prev: Record<string, Quaternion> = {};
function step(hold: boolean): Record<string, number> {
  if (hold) catchBall(p, ball);
  p.lastDt = 1 / 60;
  p.sync();
  const out: Record<string, number> = {};
  for (const b of ["LeftHand", "RightHand", "LeftLowerArm", "RightLowerArm"]) {
    const q = p.vox!.rig.node(b as never)?.rotationQuaternion;
    if (!q) continue;
    const o = prev[b];
    if (o) {
      out[b] = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(o, q)))) * 180 / Math.PI;
      o.copyFrom(q);
    } else prev[b] = q.clone();
  }
  return out;
}
for (let i = 0; i < 300; i++) step(true);          // ボールを持って落ち着かせる
console.log("パスを出した瞬間（狙いを外す）からの、1フレームあたりの回転角");
console.log("フレーム  左手     右手     左前腕   右前腕");
let maxH = 0;
for (let i = 0; i < 60; i++) {
  const d = step(false);
  maxH = Math.max(maxH, d.LeftHand ?? 0, d.RightHand ?? 0);
  if (i < 8 || i % 10 === 9) {
    console.log(`  ${String(i + 1).padStart(4)}   ${(d.LeftHand ?? 0).toFixed(1).padStart(5)}°  `
      + `${(d.RightHand ?? 0).toFixed(1).padStart(5)}°  ${(d.LeftLowerArm ?? 0).toFixed(1).padStart(5)}°  `
      + `${(d.RightLowerArm ?? 0).toFixed(1).padStart(5)}°`);
  }
}
console.log(`\n手の1フレーム最大 ${maxH.toFixed(1)}°`);
// 落ち着いたあと、震えが残っていないか
let sum = 0;
for (let i = 0; i < 120; i++) { const d = step(false); sum += (d.LeftHand ?? 0) + (d.RightHand ?? 0); }
console.log(`落ち着いたあと 2 秒間の手の合計回転 ${sum.toFixed(1)}°（0 に近いほど静か）`);
