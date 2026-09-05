// 首を出したことで、肌がユニフォームの外へ飛び出していないかを見る。
// 層ごと・方位ごとに「肌の半径」と「服の最大半径」を比べる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
const DIR = "public/vox/player_one";
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
const STEP = 0.00874, SECT = 16;
const grab = (name: string): Map<number, Map<number, number>> => {
  const pos = m.byPart.get(name)!.getVerticesData("position")!;
  const r = new Map<number, Map<number, number>>();
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (Math.abs(x) > 0.16) continue;   // 腕は素肌で当然なので除く
    const L = Math.round(y / STEP);
    const rad = Math.hypot(x, z);
    const s = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
    if (!r.has(L)) r.set(L, new Map());
    const mm = r.get(L)!;
    mm.set(s, Math.max(mm.get(s) ?? 0, rad));
  }
  return r;
};
const skin = grab("body"), cloth = grab("jersey");
let topY = -Infinity;
for (const L of skin.keys()) topY = Math.max(topY, L * STEP);
console.log("頭頂から  服の外へ出ている方位数/16  （肌の最大半径 vs その方位の服の半径）");
for (const L of [...skin.keys()].sort((a, b) => b - a)) {
  const d = topY - L * STEP;
  if (d < 0.20 || d > 0.32) continue;
  const sk = skin.get(L)!, cl = cloth.get(L);
  if (!cl) { console.log(`  ${d.toFixed(3)}  服なし（肌がむき出しでよい高さ）`); continue; }
  let out = 0, worst = 0;
  for (const [s, r] of sk) {
    const c = cl.get(s);
    if (c === undefined) continue;      // その方位に服が無い＝襟の開き。出ていて当然
    if (r > c + 0.002) { out++; worst = Math.max(worst, r - c); }
  }
  console.log(`  ${d.toFixed(3)}  ${out}/16 ${out ? `（最大 ${(worst * 1000).toFixed(0)}mm はみ出し）` : ""}`);
}

// 首の輪が方位ごとに欠けていないか（襟の内側判定で肌が落ちると輪に穴が空く）
console.log("\n首の輪の欠け（16方位のうち肌が無い方位）");
const skin2 = grab("body");
let topY2 = -Infinity;
for (const L of skin2.keys()) topY2 = Math.max(topY2, L * STEP);
for (const L of [...skin2.keys()].sort((a, b) => b - a)) {
  const d = topY2 - L * STEP;
  if (d < 0.19 || d > 0.30) continue;
  const sk = skin2.get(L)!;
  const missing: number[] = [];
  for (let s = 0; s < SECT; s++) if (!sk.has(s)) missing.push(s);
  console.log(`  ${d.toFixed(3)}  肌のある方位 ${SECT - missing.length}/${SECT}`
    + (missing.length ? `  欠け: ${missing.join(",")}` : ""));
}
