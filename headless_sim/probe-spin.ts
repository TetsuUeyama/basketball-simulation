// 足首のボーンの回転が、フレームごとに積み上がっていないかを見る。
// 座っているとき／シュートの溜め中は手続きポーズなので、誰も足首を書いていない。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Quaternion } from "@babylonjs/core";
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
await startRawPreload();
const scene = new Scene(new NullEngine());
const p = new Player(scene, 0, 0, ROSTER[0][0]);
p.pos.set(0, 0, 0); p.resetFacing(); p.stand(); p.lastDt = 1 / 60;

const deg = (q: Quaternion | null): number =>
  q ? 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI : 0;
function watch(label: string, setup: () => void, frames: number): void {
  p.stand(); setup();
  const seq: string[] = [];
  for (let i = 0; i < frames; i++) {
    p.lastDt = 1 / 60;
    setup();
    p.sync();
    if (i % 60 === 59) {
      const f = p.vox!.rig.node("LeftFoot" as never)!;
      const s = p.vox!.rig.node("LeftLowerLeg" as never)!;
      seq.push(`${deg(f.rotationQuaternion).toFixed(0)}/${deg(s.rotationQuaternion).toFixed(0)}`);
    }
  }
  console.log(`  ${label.padEnd(16)} 1秒ごとの 足首/脛の回転角: ${seq.join("  ")}`);
}
console.log("足首と脛の回転角（度）。増え続けていたら積み上がっている。");
watch("立っている", () => { p.clipOverride = "idle"; }, 600);
watch("座っている", () => { p.clipOverride = ""; p.seated = true; }, 600);
p.seated = false;
watch("シュートの溜め", () => { p.clipOverride = ""; p.shootLoadTarget = 1; }, 600);

// 全ボーンで積み上がりが無いか（手続きポーズのまま長く回して、角度が増え続けないか）
console.log("");
console.log("全ボーンの回転角の最大値（手続きポーズで 20 秒）");
for (const [label, setup] of [
  ["座っている", () => { p.clipOverride = ""; p.seated = true; }],
  ["シュートの溜め", () => { p.clipOverride = ""; p.seated = false; p.shootLoadTarget = 1; }],
  ["ただ立つ(クリップ無し)", () => { p.clipOverride = ""; p.seated = false; }],
] as [string, () => void][]) {
  p.stand(); setup();
  const early = new Map<string, number>(), late = new Map<string, number>();
  for (let i = 0; i < 1200; i++) {
    p.lastDt = 1 / 60; setup(); p.sync();
    if (i === 120 || i === 1199) {
      const t = i === 120 ? early : late;
      for (const b of p.vox!.rig.bones) {
        const n = p.vox!.rig.node(b);
        t.set(b as string, deg(n?.rotationQuaternion ?? null));
      }
    }
  }
  let worst = "", grow = 0;
  for (const [b, e] of early) {
    const d = (late.get(b) ?? 0) - e;
    if (d > grow) { grow = d; worst = b; }
  }
  console.log(`  ${label.padEnd(20)} 18秒での増加が最大のボーン: ${worst || "なし"} ${grow.toFixed(1)}°`
    + (grow > 20 ? "  ★積み上がり" : ""));
}
