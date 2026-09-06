// パスの後などに腕が小刻みに震えていないかを測る。
// 1フレームあたりの回転の変化量を全ボーンで見て、細かく往復しているものを探す。
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
const { poseHands } = await import("../src/core/poses");
const { syncAll } = await import("../src/core/visuals");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
void poseHands;

const DT = 1 / 60;
/** ボーンごとに「1フレームの回転量」と「向きが反転した回数（＝震え）」を数える。 */
const prev = new Map<string, Quaternion>();
const prevDelta = new Map<string, number>();
const sumDeg = new Map<string, number>();
const flips = new Map<string, number>();
const maxDeg = new Map<string, number>();
const p = game.roster[0][0];
for (let i = 0; i < 60 * 40; i++) {
  game.update(DT);
  syncAll(game);
  if (i < 120) continue;
  for (const b of p.vox!.rig.bones) {
    const n = p.vox!.rig.node(b);
    const q = n?.rotationQuaternion;
    if (!q) continue;
    const o = prev.get(b as string);
    if (o) {
      const dot = Math.abs(Quaternion.Dot(o, q));
      const d = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
      sumDeg.set(b as string, (sumDeg.get(b as string) ?? 0) + d);
      maxDeg.set(b as string, Math.max(maxDeg.get(b as string) ?? 0, d));
      // 向きの反転を数える（q - o の符号が毎フレーム入れ替わる＝震え）
      const s = q.x - o.x;
      const ps = prevDelta.get(b as string) ?? 0;
      if (s * ps < 0 && Math.abs(s) > 1e-4) flips.set(b as string, (flips.get(b as string) ?? 0) + 1);
      prevDelta.set(b as string, s);
      o.copyFrom(q);
    } else prev.set(b as string, q.clone());
  }
}
const rows = [...sumDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("ボーンごとの動き（38秒ぶん）。反転が多いほど小刻みに震えている。");
console.log("ボーン                合計回転   1フレーム最大   反転回数");
for (const [b, s] of rows) {
  console.log(`  ${b.padEnd(18)} ${s.toFixed(0).padStart(7)}°  ${(maxDeg.get(b) ?? 0).toFixed(1).padStart(8)}°`
    + `  ${String(flips.get(b) ?? 0).padStart(6)}`);
}
