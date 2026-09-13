// 目の段・口の段で、顔の面が列ごとにどれだけ前後しているかを測る。
// 光線と頂点の2通りで測って、測り方そのものを突き合わせる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, Ray, Vector3 } from "@babylonjs/core";
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
body.computeWorldMatrix(true);
body.refreshBoundingInfo();
const w = body.getWorldMatrix();
console.log("body のワールド行列 移動:", w.getTranslation().toString());
const P = body.getVerticesData("position")!;
const S = 0.0187504074790261;
const mm = (v: number): string => (v * 1000).toFixed(1);
const ray = (x: number, y: number): number | null => {
  const r = new Ray(new Vector3(x, y, 1.0), new Vector3(0, 0, -1), 2.0);
  const h = r.intersectsMesh(body as never);
  return h.hit ? 1.0 - h.distance : null;
};
const vert = (x: number, y: number): number | null => {
  let f = -Infinity;
  for (let i = 0; i < P.length / 3; i++) {
    if (Math.abs(P[i * 3] - x) > S) continue;
    if (Math.abs(P[i * 3 + 1] - y) > S) continue;
    f = Math.max(f, P[i * 3 + 2]);
  }
  return f === -Infinity ? null : f;
};
for (const [label, y] of [["目 上段", 1.7213], ["目 下段", 1.7026], ["口", 1.6463]] as const) {
  console.log(`\n--- ${label} (y=${(y * 100).toFixed(2)}cm) ---`);
  for (let x = -0.075; x <= 0.0751; x += S) {
    const a = ray(x, y), b = vert(x, y);
    console.log(`  x=${mm(x).padStart(6)}mm  光線 ${a === null ? " 当たらず" : mm(a).padStart(7) + "mm"}`
      + `  頂点 ${b === null ? " なし" : mm(b).padStart(7) + "mm"}`);
  }
}
