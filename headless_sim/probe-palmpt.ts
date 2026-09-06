// 手のボクセルから「手のひらの当たる点（中指の付け根あたり）」が手首からどこかを測る。
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
const scene = new Scene(new NullEngine());
const m = await buildRawModel(scene, "/vox/player_one");
const body = m.byPart.get("body") as Mesh;
const pos = body.getVerticesData("position")!;
const bi = body.getVerticesData("matricesIndices")!;
const bw = body.getVerticesData("matricesWeights")!;
const idx = new Map(m.skel.bones.map((b, i) => [b.name, i]));
// 実測済みの手のひらの法線（dribble.ts と同じ）
const PALM_N: Record<string, Vector3> = {
  LeftHand: new Vector3(0.263, -0.904, -0.338),
  RightHand: new Vector3(-0.279, -0.885, -0.373),
};
for (const hand of ["LeftHand", "RightHand"]) {
  const bone = idx.get(hand)!;
  const wrist = m.rig.restPosition(hand as never)!;
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.length / 3; i++) {
    let best = -1, bestW = 0;
    for (let k = 0; k < 4; k++) if (bw[i * 4 + k] > bestW) { bestW = bw[i * 4 + k]; best = bi[i * 4 + k]; }
    if (best !== bone || bestW < 0.6) continue;
    pts.push(new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  // 手の長軸 = 手首から頂点群の重心へ
  const c = pts.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / pts.length);
  const axis = c.subtract(wrist).normalize();
  // 長軸方向の広がり（手首から指先まで）
  let far = 0;
  for (const q of pts) far = Math.max(far, Vector3.Dot(q.subtract(wrist), axis));
  // ⚠️ 手のひらの法線は長軸と直交していない（内積 0.28）。そのまま厚みを測ると
  //    長軸方向の伸びが混ざる。直交成分だけ取り出す。
  const n0 = PALM_N[hand].clone().normalize();
  const n = n0.subtract(axis.scale(Vector3.Dot(n0, axis))).normalize();
  // 中指の付け根あたり＝長軸の 55% の位置。そこでの手のひら面までの厚み。
  const mid = far * 0.55;
  let thick = 0, cnt = 0;
  for (const q of pts) {
    const d = q.subtract(wrist);
    const t = Vector3.Dot(d, axis);
    if (Math.abs(t - mid) > 0.03) continue;      // その断面の近くだけ
    thick = Math.max(thick, Vector3.Dot(d, n)); cnt++;
  }
  const contact = wrist.add(axis.scale(mid)).add(n.scale(thick));
  void cnt;
  const off = contact.subtract(wrist);
  console.log(`${hand}: 手首 ${wrist.x.toFixed(3)},${wrist.y.toFixed(3)},${wrist.z.toFixed(3)}`);
  console.log(`  長軸 ${axis.x.toFixed(3)},${axis.y.toFixed(3)},${axis.z.toFixed(3)}  手首から指先まで ${(far * 1000).toFixed(0)}mm`
    + `  手のひら側の厚み ${(thick * 1000).toFixed(0)}mm`);
  console.log(`  当たる点（手首から） ${off.x.toFixed(3)},${off.y.toFixed(3)},${off.z.toFixed(3)}`
    + `  距離 ${(off.length() * 1000).toFixed(0)}mm`);
}
