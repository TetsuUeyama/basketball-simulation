// 膝が「選手の前」へ曲がっているかを、両チーム・両向きで確かめる。
// ⚠️ コートの向きで決めてはいけない。どの向きでも前へ曲がるのが正しい。
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
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();

console.log("チーム 番号側 体の向き   膝の位置（体の前が +）  判定");
for (const [t, side, yaw] of [
  [0, 1, 0], [0, 1, Math.PI / 2], [0, -1, 0], [1, -1, 0], [1, -1, Math.PI], [1, 1, 0],
] as [number, number, number][]) {
  const p = game.roster[t][0];
  p.stand(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60;
  p.setNumberSide(side);
  p.root.rotation.y = yaw;
  p.upright = p.uprightTarget = 0;          // 一番深い構え
  for (let i = 0; i < 3; i++) p.sync();
  p.root.computeWorldMatrix(true);
  const hip = p.vox!.rig.node("LeftUpperLeg" as never)!;
  const knee = p.vox!.rig.node("LeftLowerLeg" as never)!;
  hip.computeWorldMatrix(true); knee.computeWorldMatrix(true);
  const d = knee.getAbsolutePosition().subtract(hip.getAbsolutePosition());
  // 選手が向いている方向（root のヨー。numberSide で前後が入れ替わる規約）
  const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(-side);
  const fwd = d.x * f.x + d.z * f.z;
  console.log(`  ${t}   ${String(side).padStart(2)}   ${(yaw * 180 / Math.PI).toFixed(0).padStart(4)}°`
    + `   ${(fwd * 1000).toFixed(0).padStart(6)}mm`
    + `   ${fwd > 0.005 ? "前へ曲がる OK" : fwd < -0.005 ? "★逆関節" : "ほぼ真下"}`);
}

// 胴の前傾も向きに依らないか
console.log("");
console.log("胴の前傾（体の前が +）");
for (const [t, side, yaw] of [[0, 1, 0], [0, -1, 0], [1, 1, 1.2], [1, -1, 1.2]] as [number, number, number][]) {
  const p = game.roster[t][0];
  p.stand(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60;
  p.setNumberSide(side);
  p.root.rotation.y = yaw;
  p.upright = p.uprightTarget = 0;
  for (let i = 0; i < 3; i++) p.sync();
  p.root.computeWorldMatrix(true);
  const sp = p.vox!.rig.node("Spine" as never)!;
  const hd = p.vox!.rig.node("Head" as never)!;
  sp.computeWorldMatrix(true); hd.computeWorldMatrix(true);
  const d = hd.getAbsolutePosition().subtract(sp.getAbsolutePosition());
  const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(-side);
  const fwd = d.x * f.x + d.z * f.z;
  console.log(`  チーム${t} 番号側${String(side).padStart(2)} 向き${(yaw * 180 / Math.PI).toFixed(0).padStart(4)}°`
    + `  ${(fwd * 1000).toFixed(0).padStart(5)}mm  ${fwd > 0 ? "前傾 OK" : "★後ろへ反っている"}`);
}
