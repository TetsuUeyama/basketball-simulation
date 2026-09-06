// 確認ページと同じ組み方（Player 1体 + 手で守備度を渡す）で、腕が広がるかを見る。
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
const { defenseArms } = await import("../src/animation/action/defense-arms");
await startRawPreload();
const scene = new Scene(new NullEngine());
const p = new Player(scene, 0, 0, ROSTER[0][0]);
p.pos.set(0, 0, 0); p.resetFacing(); p.stand(); p.clipOverride = "idle"; p.lastDt = 1 / 60;

function hand(bone: string): [number, number, number] {
  const n = p.vox!.rig.node(bone as never)!;
  n.computeWorldMatrix(true);
  const w = n.getAbsolutePosition().subtract(p.pos);
  const th = p.root.rotation.y;
  const f = new Vector3(Math.sin(th), 0, Math.cos(th)).scale(-p.numberSide);
  const r = new Vector3(f.z, 0, -f.x);
  return [(w.x * r.x + w.z * r.z) * 1000, (w.x * f.x + w.z * f.z) * 1000, w.y * 1000];
}
console.log("確認ページと同じ経路（守備度を手で渡す）");
console.log("守備度  左手(横,前,高)          右手(横,前,高)");
for (const dv of [0, 0.3, 0.6, 1.0]) {
  for (let i = 0; i < 400; i++) {
    p.lastDt = 1 / 60;
    if (dv > 0.02) {
      p.defenseTarget = dv; p.defense = dv;
      const th = p.root.rotation.y;
      const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
      defenseArms(p, new Vector3(p.pos.x + fx * 1.2, p.pos.y + 1.15, p.pos.z + fz * 1.2), 0.3, 0.3, 0);
    } else { p.defenseTarget = 0; p.defense = 0; }
    p.stridePhase += (1 / 60) * 6;
    p.sync();
  }
  const L = hand("LeftHand"), R = hand("RightHand");
  console.log(`  ${dv.toFixed(2)}  ${L.map((v) => v.toFixed(0).padStart(5)).join(",")}`
    + `  ${R.map((v) => v.toFixed(0).padStart(5)).join(",")}`);
}


// 確認ページのキャッチ操作と同じ経路（ボールを置いて catchBall を呼ぶ）
const { catchBall, catchLabel } = await import("../src/animation/action/catch");
console.log("");
console.log("確認ページのキャッチ操作（ボールを正面 0.35m に置く）");
console.log("高さ  横ズレ    形");
p.stand(); p.setNumberSide(1);
for (const [by, bx] of [[2.05, 0], [2.05, 0.6], [1.35, 0], [1.35, -0.6], [0.6, 0], [0.6, 0.7]] as [number, number][]) {
  const th = p.root.rotation.y;
  const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
  const rx = fz, rz = -fx;
  const b = new Vector3(p.pos.x + fx * 0.35 + rx * bx, p.pos.y + by, p.pos.z + fz * 0.35 + rz * bx);
  let sh = catchBall(p, b);
  for (let i = 0; i < 200; i++) { sh = catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  console.log(`  ${by.toFixed(2)}m  ${(bx >= 0 ? "右 " : "左 ") + Math.abs(bx).toFixed(2)}m   ${catchLabel(p, sh)}`);
}
