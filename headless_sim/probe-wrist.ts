// ① 手首の曲がりが上限を超えないか ② ゲームと確認画面で同じ形になるか。
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
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = false;
import { clubTeam } from "../src/roster";
const { startRawPreload } = await import("../src/objects/player/player-raw");
const { catchBall } = await import("../src/animation/action/catch");
const { PALM_PT } = await import("../src/animation/action/palm");
const { poseHands } = await import("../src/core/poses");
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
const h = game.roster[0][0];
const K = h.height / 1.804;

/** 手首の曲がり角（静止姿勢から）と、当たる点→ボール中心。 */
function wristInfo(p: Player, ball: Vector3): string {
  const out: string[] = [];
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never)!;
    const q = n.rotationQuaternion ?? Quaternion.Identity();
    const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;
    n.computeWorldMatrix(true);
    const pt = Vector3.TransformCoordinates(PALM_PT[bn].scale(K), n.getWorldMatrix());
    out.push(`${ang.toFixed(0)}° ${(Vector3.Distance(pt, ball) * 1000).toFixed(0)}mm`);
  }
  return out.join(" / ");
}

const shY = h.pos.y + h.vox!.shoulder.y;
console.log("手首の曲がり角（上限 54°）と 当たる点→ボール中心（狙い 120mm）");
console.log("\n[確認画面と同じ経路] catchBall を直接");
for (const [dy, dz, note] of [
  [0.34, 0.10, "頭の上"], [0.15, 0.25, "顔の前"], [-0.15, 0.30, "胸の高さ"], [-0.35, 0.20, "腰の高さ"],
] as [number, number, string][]) {
  h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(1); h.root.rotation.y = 0;
  const b = new Vector3(0, shY + dy, -dz);
  for (let i = 0; i < 250; i++) { catchBall(h, b); h.lastDt = 1 / 60; h.sync(); }
  console.log(`  ${note.padEnd(8)} ${wristInfo(h, b)}`);
}

console.log("\n[試合と同じ経路] poseHands（キャッチをまとめている状態）");
game.ballMode = "held";
(game as unknown as { handler: Player }).handler = h;
h.holdingBall = true;
for (const [dy, dz, note] of [
  [0.34, 0.10, "頭の上"], [0.15, 0.25, "顔の前"], [-0.15, 0.30, "胸の高さ"], [-0.35, 0.20, "腰の高さ"],
] as [number, number, string][]) {
  h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(1); h.root.rotation.y = 0;
  const b = new Vector3(0, shY + dy, -dz);
  for (let i = 0; i < 250; i++) {
    h.gatherT = 1;                       // キャッチをまとめている
    game.ball.pos.copyFrom(b);
    h.lastDt = 1 / 60; h.sync(); poseHands(game);
  }
  console.log(`  ${note.padEnd(8)} ${wristInfo(h, b)}`);
}
