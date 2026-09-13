// 顔（頭の前面）の肌の色を測る。目の周り・鼻の下に肌色でないボクセルがどれだけあるか。
// ⚠️ 見るのは body メッシュの頂点カラー。ボクセル1個 = 立方体1個ではなく面をまとめてある
//    ので、ここでは**前を向いた三角形**の色と位置だけを拾う（見えている色そのもの）。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, rawPrototype } = await import("../src/objects/player/player-raw");
await startRawPreload();
const engine = new NullEngine();
const scene = new Scene(engine);
new TransformNode("p", scene);
const proto = rawPrototype(scene, 1.804, 75)!;
const body = proto.byPart.get("body")!;
const P = body.getVerticesData("position")!;
const C = body.getVerticesData("color")!;
const I = body.getIndices()!;
let top = -Infinity;
for (let i = 0; i < P.length / 3; i++) top = Math.max(top, P[i * 3 + 1]);
const S = 0.0187504074790261;

type Tri = { x: number; y: number; z: number; r: number; g: number; b: number };
const tris: Tri[] = [];
for (let t = 0; t < I.length; t += 3) {
  const a = I[t], b = I[t + 1], c = I[t + 2];
  const za = P[a * 3 + 2];
  if (Math.abs(za - P[b * 3 + 2]) > 1e-6 || Math.abs(za - P[c * 3 + 2]) > 1e-6) continue;  // 前向きだけ
  const y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
  if (top - y > 0.26) continue;                       // 頭だけ
  tris.push({
    x: (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y, z: za,
    r: Math.round(C[a * 4] * 255), g: Math.round(C[a * 4 + 1] * 255), b: Math.round(C[a * 4 + 2] * 255),
  });
}
const lum = (t: Tri): number => 0.299 * t.r + 0.587 * t.g + 0.114 * t.b;
tris.sort((p, q) => lum(p) - lum(q));
console.log("頭の前を向いた面 " + tris.length + "枚（頭頂 " + (top * 100).toFixed(1) + "cm）");
const L = tris.map(lum);
const pct = (p: number): number => L[Math.floor((L.length - 1) * p)];
console.log("明るさの分布: 最小 " + L[0].toFixed(0) + " / 5% " + pct(0.05).toFixed(0)
  + " / 25% " + pct(0.25).toFixed(0) + " / 中央 " + pct(0.5).toFixed(0)
  + " / 75% " + pct(0.75).toFixed(0) + " / 最大 " + L[L.length - 1].toFixed(0));

// 暗い面がどこにあるか（頭頂からの深さ×左右）を並べる
const mid = pct(0.5);
const dark = tris.filter((t) => lum(t) < mid * 0.80);
console.log("\n中央の 80% より暗い面 " + dark.length + "枚の位置（頭頂からの深さ cm / 左右 mm / 色）");
const rows = new Map<string, Tri[]>();
for (const t of dark) {
  const k = (Math.round((top - t.y) / S)).toString();
  if (!rows.has(k)) rows.set(k, []);
  rows.get(k)!.push(t);
}
for (const k of [...rows.keys()].sort((a, b) => Number(a) - Number(b))) {
  const r = rows.get(k)!.sort((a, b) => a.x - b.x);
  const cols = new Map<string, number>();
  for (const t of r) cols.set(t.r + "," + t.g + "," + t.b, (cols.get(t.r + "," + t.g + "," + t.b) ?? 0) + 1);
  console.log("  深さ " + ((Number(k) + 0.5) * S * 100).toFixed(1) + "cm  " + r.length + "枚  x "
    + r.map((t) => (t.x * 1000).toFixed(0)).join(",") + "mm  色 "
    + [...cols].map(([c, n]) => c + "×" + n).join(" / "));
}
