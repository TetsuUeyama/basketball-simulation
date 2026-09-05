// 1人ぶん組むのに何が時間を食っているかを測る（リグ / スケルトン / メッシュ複製）。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

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
const { preloadRawSource, buildRawModelFrom, buildRawRig } = await import("../src/voxraw");
const src = await preloadRawSource("/vox/player_one");
const engine = new NullEngine();
const scene = new Scene(engine);
const t0 = Date.now();
const proto = buildRawModelFrom(scene, src);
console.log(`見本を1体組む: ${Date.now() - t0}ms`);

for (let i = 0; i < 3; i++) {
  const root = new TransformNode(`r${i}`, scene);
  const a = Date.now();
  const { root: mr, skel } = buildRawRig(scene, src);
  const b = Date.now();
  mr.parent = root;
  let n = 0;
  for (const [part, s] of proto.byPart) {
    const m = s.clone(`${part}_${i}`, null, true);
    m.parent = mr; m.skeleton = skel; n++;
  }
  const c = Date.now();
  console.log(`${i}: リグ+スケルトン ${b - a}ms / メッシュ複製 ${n}個 ${c - b}ms`);
}
console.log(`\n見本の頂点数: ` + [...proto.byPart].map(([k, m]) => `${k}=${(m.getTotalVertices() / 1000).toFixed(0)}k`).join(" "));
