// 反射の傾き: 下半身は斜め・上半身は水平になっているか。
// 頭と胴の「上方向」がワールドの真上からどれだけ傾いているかで測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, Vector3, Matrix } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const { Game } = await import("../src/game");
const { Player } = await import("../src/objects/player/player");
const { buildCourt } = await import("../src/objects/court");
const { clubTeam } = await import("../src/roster");
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
clubTeam(0, 0); clubTeam(1, 4);
g.applyRoster(); g.reset();
const p = game.players[0];
p.pos.set(0, 0, 0);
p.root.rotation.y = 0;
/** ノードの「上方向」がワールドの真上から何度傾いているか。 */
function tiltDeg(n: TransformNode | null): number {
  if (!n) return NaN;
  n.computeWorldMatrix(true);
  const m = n.getWorldMatrix();
  const up = Vector3.TransformNormal(new Vector3(0, 1, 0), m).normalize();
  return Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI;
}
const vb = (p as unknown as { vox: { rig: { node(n: string): TransformNode | null } } | null }).vox;
if (!vb) { console.log("生モデルが組めない"); } else {
  console.log("反射の傾きを入れた時、各部がワールドの真上からどれだけ傾くか");
  for (const [tx, tz] of [[0,0],[0.20,0],[-0.20,0],[0,0.20]] as [number, number][]) {
    const t = Math.hypot(tx, tz);
    p.reflexTiltX = tx; p.reflexTiltZ = tz;
    p.tiltX = tx; p.tiltZ = tz;
    p.lastDt = 1 / 60;
    p.sync();
    const hip = tiltDeg(vb.rig.node("Hips"));
    const knee = tiltDeg(vb.rig.node("LeftLowerLeg"));
    const spine = tiltDeg(vb.rig.node("Spine"));
    const head = tiltDeg(vb.rig.node("Head"));
    console.log(`  反射 ${(t * 180 / Math.PI).toFixed(1)}° (x${tx.toFixed(2)} z${tz.toFixed(2)})  腰 ${hip.toFixed(1)}° / 膝下 ${knee.toFixed(1)}°`
      + `  →  胴 ${spine.toFixed(1)}° / 頭 ${head.toFixed(1)}°`);
  }
  console.log("※ 下半身(腰・膝下)は傾き、胴と頭が 0°に近いほど狙いどおり");
}
