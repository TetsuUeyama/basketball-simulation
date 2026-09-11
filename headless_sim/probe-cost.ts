// 選手1人ぶんの描画コスト（頂点・三角形・メッシュ数）を測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, type Mesh } from "@babylonjs/core";
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
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();
const engine = new NullEngine();
const KIT = { top: { r: 0.1, g: 0.2, b: 0.6 }, bottom: { r: 0.1, g: 0.2, b: 0.6 }, shoes: { r: 1, g: 1, b: 1 } };
const LOOK = { skin: { r: 0.8, g: 0.6, b: 0.5 }, hair: { r: 0.1, g: 0.1, b: 0.1 } };
const scene = new Scene(engine);
const root = new TransformNode("p", scene);
const b = buildRawVoxelBody(scene, root, {
  name: "cost", balance: 50, height: 1.8, weight: 75, skin: LOOK.skin, hair: LOOK.hair,
  hairNo: 1, kit: KIT, jerseyText: "8",
});
if (!b) { console.log("組めない"); } else {
  let v = 0, t = 0, n = 0;
  const rows: string[] = [];
  for (const m of b.meshes as unknown as Mesh[]) {
    const vv = m.getTotalVertices();
    const ii = m.getTotalIndices() / 3;
    if (vv === 0) continue;
    v += vv; t += ii; n++;
    rows.push(`  ${m.name.padEnd(22)} 頂点 ${String(vv).padStart(7)} / 三角形 ${String(Math.round(ii)).padStart(7)}`);
  }
  console.log(`選手1人（身長1.8m・髪型1つ・ユニフォーム込み） ボクセル ${(process.env.SZ ?? "18.75mm")}`);
  console.log(rows.join("\n"));
  console.log(`  ── 合計  メッシュ ${n} 枚 / 頂点 ${v.toLocaleString()} / 三角形 ${Math.round(t).toLocaleString()}`);
  console.log(`  10人同時（コート上）換算  頂点 ${(v * 10).toLocaleString()} / 三角形 ${Math.round(t * 10).toLocaleString()}`);
  console.log(`  ※ 頂点あたり 位置12B+法線12B+色16B+骨16B = 約56B → 1人 ${(v * 56 / 1024 / 1024).toFixed(2)}MB`);
}
