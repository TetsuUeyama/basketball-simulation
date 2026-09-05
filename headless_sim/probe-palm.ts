// 手のボクセルから「手のひらの法線」がボーンのどの軸かを割り出す。
// 手は薄い板なので、頂点のばらつきが一番小さい向き＝手のひらの法線。
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
const skel = m.skel;
const idx = new Map(skel.bones.map((b, i) => [b.name, i]));
for (const hand of ["LeftHand", "RightHand"]) {
  const bone = idx.get(hand);
  if (bone === undefined) { console.log(`${hand}: ボーンが無い`); continue; }
  // その骨が主で動く頂点だけ集める
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.length / 3; i++) {
    let best = -1, bestW = 0;
    for (let k = 0; k < 4; k++) if (bw[i * 4 + k] > bestW) { bestW = bw[i * 4 + k]; best = bi[i * 4 + k]; }
    if (best !== bone || bestW < 0.6) continue;
    pts.push(new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  if (pts.length < 30) { console.log(`${hand}: 頂点が少ない (${pts.length})`); continue; }
  // ⚠️ 手首寄りは前腕の丸みが混ざるので、指先寄りの半分だけ見る。
  const wrist = m.rig.restPosition(hand as never)!;
  pts.sort((a, b) => Vector3.Distance(b, wrist) - Vector3.Distance(a, wrist));
  const tip = pts.slice(0, Math.floor(pts.length / 2));
  const c = tip.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / tip.length);
  // ⚠️ リグの静止姿勢は回転が単位なので、ボーンのローカル軸＝モデルの軸。
  //    球面を総当たりして、ばらつきが一番小さい向き＝板の法線＝手のひらの法線。
  let best = Vector3.Zero(), bestV = Infinity, worst = Vector3.Zero(), worstV = -1;
  const N = 4000;
  for (let k = 0; k < N; k++) {
    const u = (k + 0.5) / N, phi = Math.acos(1 - 2 * u), th = Math.PI * (1 + Math.sqrt(5)) * k;
    const d = new Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    let v = 0;
    for (const q of tip) { const e = Vector3.Dot(q.subtract(c), d); v += e * e; }
    v /= tip.length;
    if (v < bestV) { bestV = v; best = d; }
    if (v > worstV) { worstV = v; worst = d; }
  }
  const sg = (v: Vector3): Vector3 => (v.y > 0 ? v.scale(-1) : v);   // 下向きに揃える
  console.log(`${hand}: 指先寄り ${tip.length} 頂点`);
  console.log(`  手のひらの法線（ばらつき最小）  ${best.x.toFixed(3)},${best.y.toFixed(3)},${best.z.toFixed(3)}`
    + `  厚み(標準偏差) ${(Math.sqrt(bestV) * 1000).toFixed(1)}mm`);
  console.log(`  手の長軸（ばらつき最大）      ${sg(worst).x.toFixed(3)},${sg(worst).y.toFixed(3)},${sg(worst).z.toFixed(3)}`
    + `  長さ(標準偏差) ${(Math.sqrt(worstV) * 1000).toFixed(1)}mm`);
}
