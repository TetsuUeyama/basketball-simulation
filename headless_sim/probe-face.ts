// 顔に描いた目・口が、元モデルと同じ枡目で・肌の外に出ているかを確かめる。
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
type JawShape = "normal" | "round" | "narrow";
const engine = new NullEngine();
for (const jaw of ["normal", "round", "narrow"] as JawShape[]) {
  const scene = new Scene(engine);
  const m = await buildRawModel(scene, "/vox/player_one", { jaw });
  const fm = m.byPart.get("face");
  if (!fm) { console.log(`${jaw}: ★ face（描いた目・口）が無い`); continue; }
  const fp = fm.getVerticesData("position")!, fc = fm.getVerticesData("color")!;
  const bp = m.byPart.get("body")!.getVerticesData("position")!;
  // 立方体1個 = 24頂点。色ごとにマス数を数える
  const cnt = new Map<string, number>();
  for (let q = 0; q < fp.length / 3; q += 24) {
    const k = [0, 1, 2].map((c) => Math.round(fc[q * 4 + c] * 255)).join(",");
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  const cell = (fp.length / 3) / 24;
  // 肌より手前に出ているか（同じ x,高さ の body の最前と比べる）
  const STEP = 0.0044;
  const front = new Map<string, number>();
  const K = (x: number, y: number): string => Math.round(x / STEP) + "," + Math.round(y / STEP);
  for (let i = 0; i < bp.length / 3; i++) {
    const k = K(bp[i * 3], bp[i * 3 + 1]);
    front.set(k, Math.max(front.get(k) ?? -9, bp[i * 3 + 2]));
  }
  let ahead = 0, behind = 0, none = 0, worst = 9;
  for (let i = 0; i < fp.length / 3; i++) {
    const bz = front.get(K(fp[i * 3], fp[i * 3 + 1]));
    if (bz === undefined) { none++; continue; }
    const d = fp[i * 3 + 2] - bz;
    if (d >= 0) ahead++; else { behind++; worst = Math.min(worst, d); }
  }
  let topY = -Infinity, minX = 9, maxX = -9, minY = 9, maxY = -9;
  for (let i = 0; i < bp.length / 3; i++) topY = Math.max(topY, bp[i * 3 + 1]);
  for (let i = 0; i < fp.length / 3; i++) {
    minX = Math.min(minX, fp[i * 3]); maxX = Math.max(maxX, fp[i * 3]);
    minY = Math.min(minY, fp[i * 3 + 1]); maxY = Math.max(maxY, fp[i * 3 + 1]);
  }
  console.log(`--- ${jaw}: ${cell} マス`);
  for (const [k, n] of [...cnt].sort((a, b) => b[1] - a[1])) console.log(`    色 ${k}: ${n} マス`);
  console.log(`    範囲 X ${minX.toFixed(3)}〜${maxX.toFixed(3)} / 頭頂から ${(topY - maxY).toFixed(3)}〜${(topY - minY).toFixed(3)}m`);
  console.log(`    肌より手前 ${ahead} 頂点 / 埋没 ${behind} / 肌が無い ${none}`
    + (behind ? ` / 最大埋没 ${(worst * 1000).toFixed(1)}mm` : ""));
  // マスの裏面と肌の面の隙間（正なら浮いている）
  const bodyS = 0.00874;
  const fr = new Map<string, number>();
  const K2 = (x: number, y: number): string => Math.round(x / bodyS) + "," + Math.round(y / bodyS);
  for (let i = 0; i < bp.length / 3; i++) {
    const k = K2(bp[i * 3], bp[i * 3 + 1]);
    fr.set(k, Math.max(fr.get(k) ?? -9, bp[i * 3 + 2]));
  }
  let gapMax = -9, gapN = 0, gapSum = 0;
  for (let q = 0; q < fp.length / 3; q += 24) {
    let cx = 0, cy = 0, cz = 0;
    for (let t = 0; t < 24; t++) { cx += fp[(q + t) * 3]; cy += fp[(q + t) * 3 + 1]; cz += fp[(q + t) * 3 + 2]; }
    cx /= 24; cy /= 24; cz /= 24;
    const bz = fr.get(K2(cx, cy));
    if (bz === undefined) continue;
    const gap = (cz - 0.0044 / 2) - bz;   // マスの裏面 - 肌の面
    gapMax = Math.max(gapMax, gap); gapSum += gap; gapN++;
    }
  console.log();
  // 顔の肌の色の階調（単色に均していないか）
  const bc = m.byPart.get("body")!.getVerticesData("color")!;
  const sh = new Map<string, number>();
  for (let i = 0; i < bp.length / 3; i++) {
    const x = bp[i * 3], y = bp[i * 3 + 1], z = bp[i * 3 + 2];
    if (z < 0.05 || topY - y < 0.08 || topY - y > 0.20 || Math.abs(x) > 0.08) continue;
    const k = [0, 1, 2].map((c) => Math.round(bc[i * 4 + c] * 255)).join(",");
    sh.set(k, (sh.get(k) ?? 0) + 1);
  }
  const t3 = [...sh].sort((a2, b2) => b2[1] - a2[1]).slice(0, 3);
  console.log(`    顔の肌の色 ${sh.size} 階調  上位: ${t3.map(([k, n]) => k + "(" + n + ")").join(" ")}`);
  // 髪型の色の散り方（モデル本来の髪と比べる）
  for (const hp of ["hair", "hairstyle_001", "hairstyle_005"]) {
    const hm = m.byPart.get(hp);
    if (!hm) continue;
    const hc = hm.getVerticesData("color")!;
    const hs = new Map<string, number>();
    for (let i = 0; i < hc.length / 4; i++) {
      const k = [0, 1, 2].map((c) => Math.round(hc[i * 4 + c] * 255)).join(",");
      hs.set(k, (hs.get(k) ?? 0) + 1);
    }
    const t3 = [...hs].sort((a2, b2) => b2[1] - a2[1]).slice(0, 4);
    console.log(`    髪の色 ${hp.padEnd(14)} ${hs.size} 階調  上位: ${t3.map(([k, n]) => k + "(" + n + ")").join(" ")}`);
  }
  scene.dispose();
}
