// モーションの切り替わりで姿勢が飛んでいないかを測る。
// 毎フレーム、各ボーンが前フレームから何度回ったかを見て、その最大値を追う。
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
p.stand(); p.resetFacing(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60;
const prev = new Map<string, Quaternion>();
/** 1フレームで一番大きく回ったボーンの角度(度)。 */
function step(): { deg: number; bone: string } {
  p.sync();
  let deg = 0, bone = "";
  for (const b of p.vox!.rig.bones) {
    const n = p.vox!.rig.node(b);
    if (!n?.rotationQuaternion) continue;
    const q = n.rotationQuaternion;
    const o = prev.get(b);
    if (o) {
      const d = Math.abs(Quaternion.Dot(o, q));
      const a = 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
      if (a > deg) { deg = a; bone = b; }
      o.copyFrom(q);
    } else prev.set(b, q.clone());
  }
  return { deg, bone };
}
for (let i = 0; i < 40; i++) step();     // 立ち姿を落ち着かせる

// 立ち → 走り → 立ち と切り替えて、繋ぎ目の飛びを測る
const log: { f: number; deg: number; bone: string; clip: string }[] = [];
for (let i = 0; i < 90; i++) {
  if (i === 20) { p.curSpd = 5.5; p.stridePhase = 0; }    // 走り出す
  if (i === 55) { p.curSpd = 0; }                          // 止まる
  if (p.curSpd > 0) p.stridePhase += 0.35;
  const r = step();
  log.push({ f: i, deg: r.deg, bone: r.bone, clip: p.clipName || "(手続き)" });
}
let worst = { deg: 0, f: 0, bone: "", clip: "" };
for (const e of log) if (e.deg > worst.deg) worst = { deg: e.deg, f: e.f, bone: e.bone, clip: e.clip };
console.log("フレーム  1フレームの最大回転  クリップ");
for (const e of log) {
  if (e.f < 18 || (e.f > 26 && e.f < 53) || e.f > 63) continue;
  console.log(`  ${String(e.f).padStart(3)}   ${e.deg.toFixed(1).padStart(6)}°  ${e.bone.padEnd(16)} ${e.clip}`);
}
console.log(`\n一番大きい飛び: ${worst.deg.toFixed(1)}° (フレーム ${worst.f}, ${worst.bone}, ${worst.clip})`);
