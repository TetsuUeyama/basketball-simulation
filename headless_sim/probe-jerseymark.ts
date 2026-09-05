// ユニフォームの柄（エンブレム・背番号・NAME）が、土台の半分のボクセルで
// ちゃんと出ているかを確かめる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const engine = new NullEngine();
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");
const parts = ["body", "jersey", "jerseymark", "shorts", "socks", "shoes"];
console.log("パーツ        頂点      色    Y範囲(高さ)");
for (const n of parts) {
  const mesh = m.byPart.get(n);
  if (!mesh) { console.log(`  ${n}: ★無い`); continue; }
  const p = mesh.getVerticesData("position")!, c = mesh.getVerticesData("color")!;
  const cs = new Set<string>();
  for (let i = 0; i < c.length / 4; i++) cs.add([0, 1, 2].map((k) => Math.round(c[i * 4 + k] * 255)).join(","));
  let lo = 9, hi = -9;
  for (let i = 0; i < p.length / 3; i++) { lo = Math.min(lo, p[i * 3 + 1]); hi = Math.max(hi, p[i * 3 + 1]); }
  console.log(`  ${n.padEnd(12)}${String(mesh.getTotalVertices()).padStart(6)}  ${String(cs.size).padStart(4)}   ${lo.toFixed(3)}〜${hi.toFixed(3)}`);
}
// 柄の色（地の赤が落ちているか）
const jm = m.byPart.get("jerseymark");
if (jm) {
  const c = jm.getVerticesData("color")!;
  const h = new Map<string, number>();
  for (let i = 0; i < c.length / 4; i++) {
    const k = [0, 1, 2].map((x) => Math.round(c[i * 4 + x] * 255)).join(",");
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  const top = [...h].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`柄の色 上位: ${top.map(([k, n]) => `${k}(${n})`).join(" ")}`);
  // 地の赤（jersey で一番多い色）がどれだけ残っているか
  const jc = m.byPart.get("jersey")!.getVerticesData("color")!;
  const jh = new Map<string, number>();
  for (let i = 0; i < jc.length / 4; i++) {
    const k = [0, 1, 2].map((x) => Math.round(jc[i * 4 + x] * 255)).join(",");
    jh.set(k, (jh.get(k) ?? 0) + 1);
  }
  const base = [...jh].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  let near = 0, far = 0;
  for (const [k, n] of h) {
    const v = k.split(",").map(Number);
    (Math.hypot(v[0] - base[0], v[1] - base[1], v[2] - base[2]) <= 90 ? (near += n) : (far += n));
  }
  console.log(`土台の色 ${base.join(",")} に近い頂点 ${near} / 柄の色 ${far}`);
}
