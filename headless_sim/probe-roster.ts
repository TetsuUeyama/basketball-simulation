// 26人ぶんを生モデルで組み、①身長が出ているか ②ジオメトリが共有できているか
// ③髪型が人ごとに違うか を測る。
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
const { startRawPreload, buildRawVoxelBody, hairPartName } = await import("../src/objects/player/player-raw");
const t0 = Date.now();
await startRawPreload();
console.log(`素材の読み込み: ${Date.now() - t0}ms\n`);

const engine = new NullEngine();
const scene = new Scene(engine);
const KIT = { top: { r: 0.8, g: 0.1, b: 0.1 }, bottom: { r: 0.8, g: 0.1, b: 0.1 }, shoes: { r: 1, g: 1, b: 1 } };

/** 実際に描かれる足元〜頭頂（ワールド境界箱）。 */
function extent(meshes: { computeWorldMatrix(f: boolean): unknown; refreshBoundingInfo(): unknown;
  getBoundingInfo(): { boundingBox: { minimumWorld: { y: number }; maximumWorld: { y: number } } } }[]) {
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) {
    m.computeWorldMatrix(true); m.refreshBoundingInfo();
    const bb = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, bb.minimumWorld.y); hi = Math.max(hi, bb.maximumWorld.y);
  }
  return { lo, hi };
}

// ゲームの選手ぶんに近い散らし方（身長 170〜215cm、BMI 21〜27、髪型はばらばら）
const N = 26;
// ⚠️ 実データに寄せる: 髪型は重複あり（同じ番号を複数人が同時に頼む）・0（髪なし）もある。
const HAIR = [1, 2, 3, 0, 5, 1, 7, 8, 2, 10, 11, 12, 0, 14, 3, 16, 17, 1, 19, 20, 21, 2, 23, 24, 0, 26];
const bodies: ReturnType<typeof buildRawVoxelBody>[] = [];
const tb = Date.now();
const lap: number[] = [];
for (let i = 0; i < N; i++) {
  const h = 1.70 + (i % 10) * 0.005 + Math.floor(i / 10) * 0.04;
  const kg = (21 + (i % 7)) * h * h;
  const t1 = Date.now();
  const parent = new TransformNode(`p${i}`, scene);
  const b = buildRawVoxelBody(scene, parent, {
    name: `t${i < 13 ? 0 : 1}_${i}`, balance: 50, height: h, weight: kg,
    skin: { r: 0.8, g: 0.6, b: 0.5 }, hair: { r: 0.1, g: 0.1, b: 0.1 },
    hairNo: HAIR[i], kit: KIT, jerseyText: String(i),
  });
  bodies.push(b);
  lap.push(Date.now() - t1);
}
console.log(`26人ぶんの組み立て: ${Date.now() - tb}ms`);
console.log("  1人ずつ: " + lap.map((x) => x + "ms").join(" "));

// 髪型は非同期で後から付く。読み終わるのを待つ。
await new Promise((r) => setTimeout(r, 8000));

let verts = 0, tris = 0, meshCount = 0;
const geos = new Set<string>();
for (const b of bodies) {
  if (!b) continue;
  meshCount += b.meshes.length;
  for (const m of b.meshes) {
    const g = m.geometry;
    if (g && !geos.has(g.uniqueId as unknown as string)) {
      geos.add(g.uniqueId as unknown as string);
      verts += m.getTotalVertices();
      tris += m.getTotalIndices() / 3;
    }
  }
}
console.log(`メッシュ ${meshCount} 個 / 実体のジオメトリ ${geos.size} 個`);
console.log(`共有後の頂点 ${(verts / 1e6).toFixed(2)}M / 三角形 ${(tris / 1e6).toFixed(2)}M`);
console.log(`（共有しなければ頂点は約 ${(verts / geos.size * meshCount / 1e6).toFixed(1)}M 相当）\n`);

console.log("番号  指定身長   描かれる高さ   差    髪型");
for (let i = 0; i < N; i++) {
  const b = bodies[i]; if (!b) continue;
  const h = b.height;
  // ⚠️ 髪は頭頂より上に出るので、身長は **body の最上端**で測る（素体側の定義と同じ）。
  const eAll = extent(b.meshes as never);
  const eBody = extent(b.meshes.filter((m) => m.name.startsWith("body_")) as never);
  const got = eBody.hi - eAll.lo;
  console.log(`  ${String(i).padStart(2)}  ${(h * 100).toFixed(1)}cm   ${(got * 100).toFixed(1)}cm`
    + `   ${((got - h) * 100 >= 0 ? "+" : "")}${((got - h) * 100).toFixed(1)}cm`
    + `  (髪込み ${((eAll.hi - eAll.lo) * 100).toFixed(1)}cm)   ${hairPartName(HAIR[i]) ?? "髪なし"}  ${b.meshes.some((m) => m.name.startsWith("hairstyle_")) === (HAIR[i] > 0) ? "OK" : "★おかしい"}`);
}
