// 顔（頭）の左右の中心が x=0 からどれだけずれているかを測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, rawPrototype } = await import("../src/objects/player/player-raw");
await startRawPreload();
const engine = new NullEngine();
const scene = new Scene(engine);
new TransformNode("p", scene);
const proto = rawPrototype(scene, 1.804, 75)!;
const body = proto.byPart.get("body")!;
const p = body.getVerticesData("position")!;
let top = -Infinity;
for (let i = 0; i < p.length / 3; i++) top = Math.max(top, p[i * 3 + 1]);
console.log("頭頂 y =", (top * 100).toFixed(2) + "cm");
// 頭頂からの深さごとに、前寄り(z が前面側)の頂点の x 範囲を見る
for (const d of [0.06, 0.08, 0.102, 0.12, 0.14, 0.172, 0.20]) {
  const y0 = top - d;
  let lo = Infinity, hi = -Infinity, zf = Infinity;
  for (let i = 0; i < p.length / 3; i++) {
    if (Math.abs(p[i * 3 + 1] - y0) > 0.010) continue;
    zf = Math.min(zf, p[i * 3 + 2]);
  }
  for (let i = 0; i < p.length / 3; i++) {
    if (Math.abs(p[i * 3 + 1] - y0) > 0.010) continue;
    if (p[i * 3 + 2] > zf + 0.03) continue;     // 前面から3cm以内だけ
    lo = Math.min(lo, p[i * 3]); hi = Math.max(hi, p[i * 3]);
  }
  console.log(`深さ ${(d * 100).toFixed(1)}cm  x ${(lo * 100).toFixed(2)}〜${(hi * 100).toFixed(2)}cm`
    + `  幅 ${((hi - lo) * 100).toFixed(2)}cm  中心 ${(((lo + hi) / 2) * 1000).toFixed(1)}mm`);
}
