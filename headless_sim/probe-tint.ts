// 選手ごとの色が狙い通りに出るかを測る。
// 頂点色（明るさ）× マテリアルの diffuse の平均が、指定した色と一致すればよい。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, type Mesh, type StandardMaterial } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());

const SKIN_HEX = ["#f7ddbe", "#cf9a6a", "#8a5a2b", "#5e3a1e"];
const HAIR_HEX = ["#0e0e0e", "#3a2413", "#7a5230", "#9a9a9a", "#c9a24b", "#e0c98a"];
const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const KIT = { top: hex("#1a3fa0"), bottom: hex("#1a3fa0"), shoes: hex("#ffffff") };

/** メッシュの「頂点色 × diffuse」の平均（実際に光が当たる前の色）。 */
function shown(m: Mesh): [number, number, number] {
  const c = m.getVerticesData("color")!; const d = (m.material as StandardMaterial).diffuseColor;
  const n = c.length / 4; let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) { r += c[i * 4] * d.r; g += c[i * 4 + 1] * d.g; b += c[i * 4 + 2] * d.b; }
  const f = (v: number) => Math.round(Math.min(1, v / n) * 255);
  return [f(r), f(g), f(b)];
}
/** まだらが残っているか（明るさの標準偏差）。 */
function spread(m: Mesh): number {
  const c = m.getVerticesData("color")!; const n = c.length / 4;
  let s = 0, q = 0;
  for (let i = 0; i < n; i++) { s += c[i * 4]; q += c[i * 4] * c[i * 4]; }
  return Math.sqrt(Math.max(0, q / n - (s / n) ** 2));
}

console.log("肌 ── 指定 → 出る色");
for (const h of SKIN_HEX) {
  const c = hex(h);
  const b = buildRawVoxelBody(scene, new TransformNode("t", scene), {
    name: `s${h}`, balance: 50, height: 1.8, weight: 75, skin: c, hair: hex("#0e0e0e"),
    hairNo: 0, kit: KIT, jerseyText: "8",
  })!;
  const body = b.meshes.find((m) => m.name.startsWith("body_"))!;
  const want = [c.r, c.g, c.b].map((v) => Math.round(v * 255));
  console.log(`  ${h} ${String(want).padEnd(14)} → ${String(shown(body)).padEnd(14)} まだら σ=${spread(body).toFixed(2)}`);
  b.dispose();
}
console.log("\n髪 ── 指定 → 出る色（★ 従来の倍率方式だと金髪が白飛びしていた箇所）");
for (const h of HAIR_HEX) {
  const c = hex(h);
  const b = buildRawVoxelBody(scene, new TransformNode("t", scene), {
    name: `h${h}`, balance: 50, height: 1.8, weight: 75, skin: hex("#cf9a6a"), hair: c,
    hairNo: 0, kit: KIT, jerseyText: "8",
  })!;
  const hair = b.meshes.find((m) => m.name.startsWith("hair_"))!;
  const want = [c.r, c.g, c.b].map((v) => Math.round(v * 255));
  console.log(`  ${h} ${String(want).padEnd(14)} → ${String(shown(hair)).padEnd(14)} まだら σ=${spread(hair).toFixed(2)}`);
  b.dispose();
}
console.log("\nユニフォーム（青チーム・白シューズ）");
{
  const b = buildRawVoxelBody(scene, new TransformNode("t", scene), {
    name: "kit", balance: 50, height: 1.8, weight: 75, skin: hex("#cf9a6a"), hair: hex("#0e0e0e"),
    hairNo: 0, kit: KIT, jerseyText: "8",
  })!;
  for (const m of b.meshes) {
    const part = m.name.replace(/_kit$/, "");
    console.log(`  ${part.padEnd(12)} ${String(shown(m as Mesh))}`);
  }
}
