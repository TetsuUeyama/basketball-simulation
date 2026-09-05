// 背中のマーク（番号とName）の高さの分布を見る。番号の帯を切り出す判定の下調べ。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const m = await buildRawModel(new Scene(new NullEngine()), "/vox/player_one");
const mesh = m.byPart.get("jerseymark")!;
const p = mesh.getVerticesData("position")!, idx = mesh.getIndices()!;
const ys = new Set<number>();
for (let t = 0; t < idx.length; t += 3) {
  if (![0, 1, 2].every((j) => p[idx[t + j] * 3 + 2] < -0.05)) continue;
  for (let j = 0; j < 3; j++) ys.add(Math.round(p[idx[t + j] * 3 + 1] * 2000) / 2000);
}
const a = [...ys].sort((x, y) => x - y);
console.log(`背中側のマークの高さ ${a.length} 段  ${a[0].toFixed(3)}〜${a[a.length - 1].toFixed(3)}`);
const gaps: string[] = [];
for (let i = 1; i < a.length; i++) {
  const d = a[i] - a[i - 1];
  if (d > 0.003) gaps.push(`${a[i - 1].toFixed(3)}→${a[i].toFixed(3)} (${(d * 1000).toFixed(1)}mm)`);
}
console.log(`3mm 以上あいている所: ${gaps.length} 箇所`);
console.log("  " + gaps.join("\n  "));
