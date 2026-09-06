// 守備度: ハンドラーに近いほど腕が広がるか、左右が別々に動いているかを見る。
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
const { defenseTargetFor } = await import("../src/animation/action/defense-arms");
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
const h = game.roster[0][0];      // ハンドラー
const d = game.roster[1][0];      // 守備者
game.ballMode = "held";
(game as unknown as { handler: Player }).handler = h;
h.holdingBall = true;

/** 手の位置（守備者の体から見た 横・前・高さ、mm）。 */
function hand(p: Player, bone: string): [number, number, number] {
  const n = p.vox!.rig.node(bone as never)!;
  n.computeWorldMatrix(true);
  const w = n.getAbsolutePosition().subtract(p.pos);
  const th = p.root.rotation.y;
  const f = new Vector3(Math.sin(th), 0, Math.cos(th)).scale(-p.numberSide);
  const r = new Vector3(f.z, 0, -f.x);
  return [(w.x * r.x + w.z * r.z) * 1000, (w.x * f.x + w.z * f.z) * 1000, w.y * 1000];
}

for (const [side, yaw] of [[1, 0], [-1, 0]] as [number, number][]) {
  console.log(`\n== 守備者の番号側 ${side} ==`);
  console.log("距離   守備度  左手(横,前,高)          右手(横,前,高)         左右の差");
  for (const dist of [5.0, 3.0, 2.0, 1.2, 0.8]) {
    h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(1); h.root.rotation.y = 0;
    d.stand(); d.pos.set(0, 0, -dist); d.setNumberSide(side); d.root.rotation.y = yaw;
    d.upright = d.uprightTarget = 0.4;
    h.velX = 0; h.velZ = 0;
    for (let i = 0; i < 400; i++) {
      game.ball.pos.set(h.pos.x + 0.25, 0.9, h.pos.z);
      h.lastDt = d.lastDt = 1 / 60;
      d.defenseTarget = defenseTargetFor(d, h);
      h.sync(); d.sync();
      poseHands(game);
    }
    const L = hand(d, "LeftHand"), R = hand(d, "RightHand");
    const diff = Math.hypot(L[0] + R[0], L[1] - R[1], L[2] - R[2]);   // 鏡像からのズレ
    console.log(`  ${dist.toFixed(1)}m  ${d.defense.toFixed(2)}`
      + `  ${L.map((v) => v.toFixed(0).padStart(5)).join(",")}`
      + `  ${R.map((v) => v.toFixed(0).padStart(5)).join(",")}`
      + `  ${diff.toFixed(0)}mm`);
  }
}

// 時間で混ざり方が移ろうか（1.0m で 20 秒）
console.log("\n混ざり方の移ろい（距離 1.0m、2秒ごとの左右の手の高さ mm）");
h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(1); h.root.rotation.y = 0;
d.stand(); d.pos.set(0, 0, -1.0); d.setNumberSide(1); d.root.rotation.y = 0;
d.upright = d.uprightTarget = 0.4;
const seq: string[] = [];
for (let k = 0; k < 10; k++) {
  for (let i = 0; i < 120; i++) {
    game.ball.pos.set(0.25, 0.9, 0);
    d.defenseTarget = defenseTargetFor(d, h);
    h.lastDt = d.lastDt = 1 / 60; h.sync(); d.sync(); poseHands(game);
  }
  seq.push(`${hand(d, "LeftHand")[2].toFixed(0)}/${hand(d, "RightHand")[2].toFixed(0)}`);
}
console.log("  " + seq.join("  "));
