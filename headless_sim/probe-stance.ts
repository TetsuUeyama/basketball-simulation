// 直立度で立ち姿がどう変わるかを測る。膝の曲がりと腕の開き、腰の高さ。
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
const { uprightTargetFor } = await import("../src/animation/basic/stance");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();

const p = game.roster[0][0];
p.stand(); p.resetFacing(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60; p.holdingBall = false;
function ang(a: string, b: string): number {
  const na = p.vox!.rig.node(a as never)!, nb = p.vox!.rig.node(b as never)!;
  na.computeWorldMatrix(true); nb.computeWorldMatrix(true);
  const d = nb.getAbsolutePosition().subtract(na.getAbsolutePosition());
  return Math.acos(Math.min(1, Math.max(-1, -d.y / d.length()))) * 180 / Math.PI;
}
console.log("直立度  腿の前傾  脛の角度  上腕の開き  腰の高さ  手の横位置");
for (const u of [1.0, 0.75, 0.5, 0.25, 0.0]) {
  p.upright = p.uprightTarget = u;
  for (let i = 0; i < 3; i++) p.sync();
  p.root.computeWorldMatrix(true);
  const hips = p.vox!.rig.node("Hips" as never)!;
  hips.computeWorldMatrix(true);
  const hand = p.vox!.rig.node("LeftHand" as never)!;
  hand.computeWorldMatrix(true);
  console.log(`  ${u.toFixed(2)}   ${ang("LeftUpperLeg", "LeftLowerLeg").toFixed(1).padStart(6)}°`
    + `  ${ang("LeftLowerLeg", "LeftFoot").toFixed(1).padStart(6)}°`
    + `  ${ang("LeftUpperArm", "LeftLowerArm").toFixed(1).padStart(7)}°`
    + `  ${hips.getAbsolutePosition().y.toFixed(3)}m`
    + `  ${Math.abs(hand.getAbsolutePosition().x - p.pos.x).toFixed(3)}m`);
}
// 足が床から浮いていないか
p.upright = p.uprightTarget = 0; for (let i = 0; i < 3; i++) p.sync();
const foot = p.vox!.rig.node("LeftFoot" as never)!; foot.computeWorldMatrix(true);
console.log(`\n最も低い構えでの足首の高さ ${foot.getAbsolutePosition().y.toFixed(3)}m`);

console.log("\n試合中の直立度（ボールとの距離ごと）");
for (const d of [1, 3, 5, 9, 14]) {
  const off = uprightTargetFor(p, d, 0, true), def = uprightTargetFor(p, d, 0, false);
  console.log(`  ボールまで ${String(d).padStart(2)}m  オフェンス ${off.toFixed(2)}  ディフェンス ${def.toFixed(2)}`);
}

// 足が床に残っているか（直立度を変えても足首の高さが変わらないこと）
console.log("\n直立度ごとの足首の高さ（変わらなければ足は床に残っている）");
for (const u of [1.0, 0.5, 0.0]) {
  p.upright = p.uprightTarget = u;
  for (let i = 0; i < 3; i++) p.sync();
  const f = p.vox!.rig.node("LeftFoot" as never)!;
  f.computeWorldMatrix(true);
  console.log(`  直立度 ${u.toFixed(2)}  足首 ${f.getAbsolutePosition().y.toFixed(4)}m`);
}
