// 手のメッシュの「外側の点」を取り出す。ボールに当たる判定はこの点で行う。
// 指のボーンの位置は肉の内側なので、それだけ見ていると表面が貫通する。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, type Mesh } from "@babylonjs/core";
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
const body = m.byPart.get("body") as Mesh;
const pos = body.getVerticesData("position")!;
const bi = body.getVerticesData("matricesIndices")!;
const bw = body.getVerticesData("matricesWeights")!;
const idx = new Map(m.skel.bones.map((b, i) => [b.name, i]));
for (const hand of ["LeftHand", "RightHand"] as const) {
  const bone = idx.get(hand)!;
  const wrist = m.rig.restPosition(hand as never)!;
  // その骨が少しでも効いている頂点（＝手の肉）
  const pts: Vector3[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pos.length / 3; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (bi[i * 4 + k] === bone) w = Math.max(w, bw[i * 4 + k]);
    if (w < 0.5) continue;
    const v = new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).subtract(wrist);
    const key = [v.x, v.y, v.z].map((q) => Math.round(q * 200)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push(v);
  }
  // いちばん離れた点から順に、互いに離れた点を選ぶ（最遠点サンプリング）
  const N = 14;
  const picked: Vector3[] = [];
  let first = pts[0];
  for (const q of pts) if (q.length() > first.length()) first = q;
  picked.push(first);
  while (picked.length < N) {
    let best = pts[0], bestD = -1;
    for (const q of pts) {
      let d = Infinity;
      for (const s of picked) d = Math.min(d, Vector3.DistanceSquared(q, s));
      if (d > bestD) { bestD = d; best = q; }
    }
    picked.push(best);
  }
  console.log(`  ${hand}: [   // 手の肉 ${pts.length} 頂点から ${N} 点`);
  for (const q of picked) {
    console.log(`    new Vector3(${q.x.toFixed(3)}, ${q.y.toFixed(3)}, ${q.z.toFixed(3)}),`
      + `   // 手首から ${(q.length() * 1000).toFixed(0)}mm`);
  }
  console.log("  ],");
}
