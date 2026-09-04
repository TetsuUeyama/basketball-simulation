// 現行のボクセル選手1人ぶんの描画コスト（メッシュ数・頂点数・三角形数）を実測する。
// 新モデル（ポリゴンFBX）へ置き換える判断の比較材料。
import "./stubs";
import { NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { buildPartMesh, buildUniformMesh, partStretch, variantFor, bodyData,
         DEFAULT_WIDTH_EXPONENT, DEFAULT_HEAD_EXPONENT } from "../vendor/objcts/player/voxel/voxelBody";

const engine = new NullEngine();
const scene = new Scene(engine);

const HEIGHT = Number(process.env.H ?? 1.95);
const variant = variantFor(Number(process.env.BAL ?? 70));
const st = partStretch(variant, HEIGHT, DEFAULT_WIDTH_EXPONENT, DEFAULT_HEAD_EXPONENT);
const parts = Object.keys(bodyData(variant).parts);

let meshes = 0, verts = 0, tris = 0;
const rows: string[] = [];
const tally = (label: string, m: { getTotalVertices(): number; getTotalIndices(): number } | null): void => {
  if (!m) return;
  meshes++;
  const v = m.getTotalVertices(), t = m.getTotalIndices() / 3;
  verts += v; tris += t;
  rows.push(`  ${label.padEnd(12)} 頂点 ${String(v).padStart(6)}  三角形 ${String(t).padStart(6)}`);
};

for (const part of parts) {
  const s = st[part] ?? { x: 0, y: 0, z: 0 };
  tally(part, buildPartMesh(scene, variant, part, s, "bake", null, 0, true));
}
for (const role of ["jersey", "shorts", "shoes"]) {
  try {
    const m = (buildUniformMesh as unknown as (s: unknown, v: unknown, h: number, k: string) => never)(scene, variant, HEIGHT, role);
    tally(role, m as never);
  } catch { /* 引数形が違えばスキップ（下の合計から除く） */ }
}

console.log(`現行ボクセルモデル 1人ぶん（体型=${variant} / 身長=${HEIGHT}m、服の下の地肌は除去済み）`);
console.log(rows.join("\n"));
console.log(`  ── 合計: メッシュ ${meshes} / 頂点 ${verts} / 三角形 ${tris}`);
console.log(`  コート上10人ぶん: 三角形 ${tris * 10} / 26人ぶん: 三角形 ${tris * 26}`);
console.log(`\n⚠️ 服・髪・顔はここに含んでいない（buildUniformMesh の引数形が違えばスキップ）。`);
void VertexBuffer;
