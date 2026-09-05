// 従来モデルと生モデルで、26人ぶんの重さを同じ物差しで比べる。
//   メッシュ数      … 描画呼び出しの数（毎フレームの負担）
//   毎フレーム三角形 … 実際に描く量（共有していても人数ぶん描く）
//   実体ジオメトリ   … メモリに載る量（共有ぶんは1つと数える）
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, type Mesh } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildVoxelBody } = await import("../src/objects/player/player-voxel");
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
const { resolveLook } = await import("../src/objects/player/player-look");
await startRawPreload();

const KIT = { top: { r: .1, g: .25, b: .6 }, bottom: { r: .1, g: .25, b: .6 }, shoes: { r: 1, g: 1, b: 1 } };
// 実データに近い26人（身長170〜210cm、BMI 20〜27、髪型と肌/髪の色はばらばら）
const ROSTER = Array.from({ length: 26 }, (_, i) => {
  const h = 1.70 + (i % 13) * 0.0031 + Math.floor(i / 13) * 0.06;
  return { h, kg: (20 + (i % 8)) * h * h, look: resolveLook([i % 8, i % 11, i % 13, (i * 5) % 140]) };
});

type Body = { meshes: Mesh[]; shadowMeshes: Mesh[]; skel: { bones: unknown[] } };
function measure(label: string, make: (scene: Scene, p: TransformNode, i: number) => Body | null) {
  const scene = new Scene(new NullEngine());
  const t = Date.now();
  const bodies: Body[] = [];
  for (let i = 0; i < 26; i++) {
    const b = make(scene, new TransformNode(`p${i}`, scene), i);
    if (b) bodies.push(b);
  }
  const ms = Date.now() - t;
  let meshes = 0, tris = 0, bones = 0, shadow = 0;
  const geos = new Map<number, number>();
  for (const b of bodies) {
    bones += b.skel.bones.length;
    shadow += b.shadowMeshes.length;
    for (const m of b.meshes) {
      meshes++;
      const t2 = m.getTotalIndices() / 3;
      tris += t2;
      if (m.geometry) geos.set(m.geometry.uniqueId, t2);
    }
  }
  let uniq = 0; for (const v of geos.values()) uniq += v;
  return { label, ms, meshes, tris, uniq, geos: geos.size, bones, shadow, n: bodies.length };
}

const a = measure("従来", (s, p, i) => buildVoxelBody(s, p, {
  name: `b${i}`, balance: 50, height: ROSTER[i].h, skin: ROSTER[i].look.skin,
  hair: ROSTER[i].look.hair, hairNo: ROSTER[i].look.hairNo, kit: KIT, jerseyText: String(i),
}) as unknown as Body);
const b = measure("生", (s, p, i) => buildRawVoxelBody(s, p, {
  name: `r${i}`, balance: 50, height: ROSTER[i].h, weight: ROSTER[i].kg, skin: ROSTER[i].look.skin,
  hair: ROSTER[i].look.hair, hairNo: ROSTER[i].look.hairNo, kit: KIT, jerseyText: String(i),
}) as unknown as Body);
// 髪型は後から届くので待ってから数え直す
await new Promise((r) => setTimeout(r, 10000));

const row = (k: string, x: string, y: string, note = "") =>
  console.log(`${k.padEnd(26)}${x.padStart(11)}${y.padStart(12)}   ${note}`);
console.log("");
row("", "従来モデル", "生モデル");
console.log("-".repeat(72));
row("26人を組む時間", `${a.ms}ms`, `${b.ms}ms`, b.ms < a.ms ? "生のほうが速い" : "生のほうが遅い");
row("メッシュ数", String(a.meshes), String(b.meshes), "描画呼び出しの数");
row("毎フレーム描く三角形", `${(a.tris / 1e6).toFixed(2)}M`, `${(b.tris / 1e6).toFixed(2)}M`, "GPU の負担");
row("影に落とすメッシュ", String(a.shadow), String(b.shadow), "影は同じものをもう一度描く");
row("実体のジオメトリ", String(a.geos), String(b.geos), "メモリに載る本数");
row("メモリ上の三角形", `${(a.uniq / 1e6).toFixed(2)}M`, `${(b.uniq / 1e6).toFixed(2)}M`, "共有ぶんは1つと数える");
row("ボーン合計", String(a.bones), String(b.bones), "毎フレームの行列更新");

// 生モデルの内訳（1人ぶん）。どこを削れば効くかを見る。
console.log("");
console.log("生モデル 1人ぶんの内訳");
{
  const scene = new Scene(new NullEngine());
  const vb = buildRawVoxelBody(scene, new TransformNode("z", scene), {
    name: "z", balance: 50, height: 1.8, weight: 75, skin: ROSTER[0].look.skin,
    hair: ROSTER[0].look.hair, hairNo: 1, kit: KIT, jerseyText: "8",
  })!;
  await new Promise((r) => setTimeout(r, 3000));
  const rows = (vb.meshes as Mesh[]).map((m) => ({
    name: m.name.replace(/_z$/, ""), tri: m.getTotalIndices() / 3,
  })).sort((x, y) => y.tri - x.tri);
  const tot = rows.reduce((s, r) => s + r.tri, 0);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(16)}${String(r.tri).padStart(8)} 三角形  ${(r.tri / tot * 100).toFixed(1)}%`);
  }
  console.log(`  ${"合計".padEnd(16)}${String(tot).padStart(8)} 三角形  × 26人 = ${(tot * 26 / 1e6).toFixed(2)}M`);
}
