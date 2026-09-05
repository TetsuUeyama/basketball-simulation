// 顔と足裏が水平を保っているかを測る。
//   顔: 頭の向きベクトルの上下成分（0 = 真っ直ぐ前）
//   足裏: 足の「上」が真上からどれだけ傾いているか
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
const p = game.roster[0][0];
const UP = new Vector3(0, 1, 0);
function dirOf(bone: string, local: Vector3): Vector3 {
  const n = p.vox!.rig.node(bone as never)!;
  n.computeWorldMatrix(true);
  const m = n.getWorldMatrix();
  const o = Vector3.TransformCoordinates(Vector3.Zero(), m);
  return Vector3.TransformCoordinates(local, m).subtract(o).normalize();
}
console.log("直立度  顔の上下  足裏の傾き(左)  足裏の傾き(右)  前腕の前");
for (const u of [1.0, 0.75, 0.5, 0.25, 0.0]) {
  p.stand(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60; p.setNumberSide(1); p.root.rotation.y = 0;
  p.upright = p.uprightTarget = u;
  for (let i = 0; i < 3; i++) p.sync();
  p.root.computeWorldMatrix(true);
  const face = dirOf("Head", new Vector3(0, 0, 1));
  const fl = dirOf("LeftFoot", UP), fr = dirOf("RightFoot", UP);
  const deg = (v: Vector3) => Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(v, UP)))) * 180 / Math.PI;
  const el = p.vox!.rig.node("LeftLowerArm" as never)!, hd = p.vox!.rig.node("LeftHand" as never)!;
  el.computeWorldMatrix(true); hd.computeWorldMatrix(true);
  const fa = hd.getAbsolutePosition().subtract(el.getAbsolutePosition());
  console.log(`  ${u.toFixed(2)}  ${(Math.asin(Math.max(-1, Math.min(1, face.y))) * 180 / Math.PI).toFixed(1).padStart(7)}°`
    + `  ${deg(fl).toFixed(1).padStart(12)}°  ${deg(fr).toFixed(1).padStart(12)}°`
    + `  ${(-fa.z * 1000).toFixed(0).padStart(7)}mm`);
}
