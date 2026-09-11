// ポリゴン検証ページの素材(GLB)の中身を直接読んで、ページが必要とするものが
// 揃っているかを確かめる。⚠️ Babylon を通さない（Node に XHR が無く、
// Babylon の内部がそれを直接使うため）。ブラウザでの実際の描画は poly.html で見る。
import { readFileSync } from "node:fs";

/** GLB の JSON チャンクを取り出す。 */
function glbJson(path: string): { json: Record<string, unknown>; bytes: number } {
  const b = readFileSync(path);
  const magic = b.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(path + " は GLB ではない");
  const len = b.readUInt32LE(12);
  const type = b.readUInt32LE(16);
  if (type !== 0x4e4f534a) throw new Error("最初のチャンクが JSON でない");
  return { json: JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as Record<string, unknown>, bytes: b.length };
}
type Prim = { indices?: number; attributes?: Record<string, number> };
type Mesh = { name?: string; primitives?: Prim[] };
type Acc = { count?: number };

function report(path: string, label: string): void {
  const { json, bytes } = glbJson(path);
  const meshes = (json.meshes ?? []) as Mesh[];
  const acc = (json.accessors ?? []) as Acc[];
  const nodes = (json.nodes ?? []) as { name?: string; mesh?: number; skin?: number }[];
  const skins = (json.skins ?? []) as { joints?: number[] }[];
  let tri = 0, vert = 0;
  for (const m of meshes) {
    for (const p of m.primitives ?? []) {
      if (p.indices !== undefined) tri += (acc[p.indices]?.count ?? 0) / 3;
      const pos = p.attributes?.POSITION;
      if (pos !== undefined) vert += acc[pos]?.count ?? 0;
    }
  }
  console.log(`${label} (${path.split("/").pop()}) ${(bytes / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  メッシュ ${meshes.length} / 頂点 ${vert.toLocaleString()} / 三角形 ${Math.round(tri).toLocaleString()}`);
  console.log(`  メッシュ名: ${meshes.map((m) => m.name ?? "?").slice(0, 10).join(", ")}`);
  if (skins.length) {
    const joints = (skins[0].joints ?? []).map((i) => nodes[i]?.name ?? "?");
    const want = ["Hips", "Spine", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "Head"];
    const has = (n: string): boolean => joints.some((j) => j === n || j.endsWith(":" + n) || j.endsWith("_" + n));
    console.log(`  ボーン ${joints.length} 本 / 必要なもの: ${want.map((n) => n + (has(n) ? "○" : "×")).join(" ")}`);
  }
  if (meshes.length > 1 && meshes.length <= 12) {
    for (const m of meshes) {
      let t = 0;
      for (const p of m.primitives ?? []) if (p.indices !== undefined) t += (acc[p.indices]?.count ?? 0) / 3;
      console.log(`    ${(m.name ?? "?").padEnd(18)} 三角形 ${Math.round(t).toLocaleString()}`);
    }
  }
}
const D = "public/poly/";
report(D + "player.glb", "選手モデル");
console.log();
report(D + "hair_low.glb", "髪（間引き25%）");
console.log();
report(D + "hair.glb", "髪（生データ）");
console.log("\n※ 現行のボクセル(18.75mm) 1人 = 頂点 85,728 / 三角形 40,896");
