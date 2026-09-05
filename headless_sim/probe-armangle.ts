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
console.log("直立度  上腕の開き  前腕の開き  手の前後   手の高さ  膝の前後");
for (const u of [1.0, 0.8, 0.6, 0.4, 0.2, 0.0]) {
  // 揺れを平均で見るため、少し回して真ん中あたりを取る
  let a1 = 0, a2 = 0, hz = 0, hy = 0, kz = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    p.upright = p.uprightTarget = u;
    p.sync();
    if (i < 120) continue;
    p.root.computeWorldMatrix(true);
    a1 += ang("LeftUpperArm", "LeftLowerArm"); a2 += ang("LeftLowerArm", "LeftHand");
    const h = at("LeftHand").subtract(p.pos), k = at("LeftLowerLeg").subtract(p.pos);
    hz += h.z * 1000; hy += h.y * 1000; kz += k.z * 1000; n++;
  }
  console.log(`  ${u.toFixed(2)}  ${(a1 / n).toFixed(1).padStart(8)}°  ${(a2 / n).toFixed(1).padStart(8)}°`
    + `  ${(hz / n).toFixed(0).padStart(7)}mm  ${(hy / n).toFixed(0).padStart(7)}mm  ${(kz / n).toFixed(0).padStart(7)}mm`);
}
