// 生モデルの各部位の頂点色の代表値を測る（マテリアルの倍率を決めるための基準色）。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const scene = new Scene(new NullEngine());
const m = await buildRawModel(scene, "/vox/player_one");
await m.loadHair("hairstyle_001");
console.log("部位          平均色(0-255)      最頻色(0-255)  頂点数");
for (const [name, mesh] of m.byPart) {
  const c = mesh.getVerticesData("color"); if (!c) continue;
  const n = c.length / 4;
  let r = 0, g = 0, b = 0; const hist = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const R = c[i * 4], G = c[i * 4 + 1], B = c[i * 4 + 2];
    r += R; g += G; b += B;
    const k = `${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)}`;
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const top = [...hist].sort((a, b2) => b2[1] - a[1])[0];
  console.log(`${name.padEnd(14)}${[r, g, b].map((v) => String(Math.round(v / n * 255)).padStart(4)).join("")}`
    + `        ${top[0].padEnd(14)} ${n}`);
}
