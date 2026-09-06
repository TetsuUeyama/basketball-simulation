// キャッチの形が、ボールの高さと横ズレで変わるかを見る。
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
const { catchBall, catchLabel } = await import("../src/animation/action/catch");
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
for (const side of [1, -1]) {
  p.setNumberSide(side);
  console.log(`\n== 番号側 ${side}（身長 ${(p.height * 100).toFixed(0)}cm、肩 ${(p.vox!.shoulder.y * 100).toFixed(0)}cm） ==`);
  console.log("ボール(高さ,横)      形            左手(横,前,高)          右手(横,前,高)   手の間隔");
  for (const [by, bx, note] of [
    [2.35, 0.00, "リバウンド(立ち・届かない)"],
    [2.05, 0.00, "リバウンド 頭の上・正面"],
    [2.35, 0.55, "頭の上・右へズレ"],
    [2.35, -0.55, "頭の上・左へズレ"],
    [1.35, 0.00, "胸の高さ・正面"],
    [1.35, 0.60, "胸の高さ・右へズレ"],
    [0.60, 0.00, "低い・正面"],
  ] as [number, number, string][]) {
    p.stand();
    const b = new Vector3(bx, by, 0.35);
    let sh = catchBall(p, b);
    for (let i = 0; i < 200; i++) { sh = catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
    const L = hand("LeftHand"), R = hand("RightHand");
    const sep = Math.hypot(L[0] - R[0], L[1] - R[1], L[2] - R[2]);
    console.log(`  ${note.padEnd(18)} ${catchLabel(p, sh).padEnd(14)}`
      + ` ${L.map((v) => v.toFixed(0).padStart(5)).join(",")}`
      + ` ${R.map((v) => v.toFixed(0).padStart(5)).join(",")}`
      + `  ${sep.toFixed(0)}mm`);
  }
}
