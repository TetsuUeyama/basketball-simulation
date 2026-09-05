// 肩・上腕・前腕の角度が、直立度に対してどう並ぶかを見る。
// 「直立度 100% が以前の 60% と同じ」になっているかの確認。
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
p.stand(); p.pos.set(0, 0, 0); p.setNumberSide(1); p.root.rotation.y = 0; p.lastDt = 1 / 60;
const at = (b: string): Vector3 => {
  const n = p.vox!.rig.node(b as never)!; n.computeWorldMatrix(true);
  return n.getAbsolutePosition();
};
const ang = (a: string, b: string): number => {
  const d = at(b).subtract(at(a));
  return Math.acos(Math.min(1, Math.max(-1, -d.y / d.length()))) * 180 / Math.PI;
};
/** 上腕が体から横へどれだけ離れているか（正面から見た開き）。 */
const sideAng = (): number => {
  const d = at("LeftLowerArm").subtract(at("LeftUpperArm"));
  return Math.atan2(Math.abs(d.x), Math.max(1e-6, -d.y)) * 180 / Math.PI;
};
console.log("直立度  肩の横の開き  前腕の横の開き  上腕の前傾  前腕の前傾  手の横   手の前");
for (const u of [1.0, 0.8, 0.6, 0.4, 0.2, 0.0]) {
  // 揺れを平均で見るため、少し回して真ん中あたりを取る
  let a0 = 0, a3 = 0, a1 = 0, a2 = 0, hx = 0, hz = 0, hy = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    p.upright = p.uprightTarget = u;
    p.sync();
    if (i < 120) continue;
    p.root.computeWorldMatrix(true);
    a0 += sideAng();
    {
      const d2 = at("LeftHand").subtract(at("LeftLowerArm"));
      a3 += Math.atan2(Math.abs(d2.x), Math.max(1e-6, -d2.y)) * 180 / Math.PI;
    }
    // 前後の傾き（横成分を除いた、真下からの前後角）
    const du = at("LeftLowerArm").subtract(at("LeftUpperArm"));
    const df = at("LeftHand").subtract(at("LeftLowerArm"));
    a1 += Math.atan2(-du.z, Math.max(1e-6, -du.y)) * 180 / Math.PI;
    a2 += Math.atan2(-df.z, Math.max(1e-6, -df.y)) * 180 / Math.PI;
    const h = at("LeftHand").subtract(p.pos);
    hx += Math.abs(h.x) * 1000; hz += -h.z * 1000; hy += h.y * 1000; n++;
  }
  console.log(`  ${u.toFixed(2)}  ${(a0 / n).toFixed(1).padStart(10)}°  ${(a3 / n).toFixed(1).padStart(12)}°`
    + `  ${(a1 / n).toFixed(1).padStart(8)}°  ${(a2 / n).toFixed(1).padStart(8)}°`
    + `  ${(hx / n).toFixed(0).padStart(6)}mm  ${(hz / n).toFixed(0).padStart(6)}mm`);
}
