// 描いた目・口が顔に密着しているか（浮いていないか / 埋もれていないか）を測る。
// ⚠️ 格子で丸めて比べると升目がずれる（実測でそれを食い込みと誤読した）。
//    マスの周り半ボクセル以内にある肌の頂点の一番手前と直接比べる。
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
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};
const { buildRawModel } = await import("../src/voxraw");
type JawShape = "normal" | "round" | "narrow";

const BODY_S = 0.008740;
const MARK_S = BODY_S / 2;
const engine = new NullEngine();
for (const jaw of ["normal", "round", "narrow"] as JawShape[]) {
  const scene = new Scene(engine);
  const m = await buildRawModel(scene, "/vox/player_one", { jaw });
  const fm = m.byPart.get("face");
  if (!fm) { console.log(`${jaw}: ★ face が無い`); continue; }
  const fp = fm.getVerticesData("position")!;
  const bp = m.byPart.get("body")!.getVerticesData("position")!;

  let topY = -Infinity;
  for (let i = 0; i < bp.length / 3; i++) topY = Math.max(topY, bp[i * 3 + 1]);
  // ⚠️ 頂点のまま半ボクセルの窓で拾うと、隣の列（鼻など）の面まで入って誤って
  //    「埋没」と出る。面の中心から法線ぶん戻してボクセル中心を復元し、**同じ列**で比べる。
  const bn = m.byPart.get("body")!.getVerticesData("normal")!;
  // ⚠️ この計測は近似。voxraw は格子の原点を知っているが、ここはメッシュからしか復元
  //    できないので、升目の境目にあるマス（実測8個）は隣の升目と比べてしまう。
  //    配置そのものは voxraw 側で「自分の列の一番手前の肌」から 1.1mm 食い込ませており、
  //    構造上 3.3mm 手前に出る。ここでは「浮きが無いこと」を見る。
  const skinCell = new Map<string, number>();
  for (let q = 0; q < bp.length / 3; q += 4) {
    let ax = 0, ay = 0, az = 0;
    for (let t = 0; t < 4; t++) { ax += bp[(q + t) * 3]; ay += bp[(q + t) * 3 + 1]; az += bp[(q + t) * 3 + 2]; }
    const vx = ax / 4 - bn[q * 3] * BODY_S / 2;
    const vy = ay / 4 - bn[q * 3 + 1] * BODY_S / 2;
    const vz = az / 4 - bn[q * 3 + 2] * BODY_S / 2;
    if (vz < 0 || topY - vy > 0.24 || Math.abs(vx) > 0.12) continue;
    const k = Math.round(vx / BODY_S) + "," + Math.round(vy / BODY_S);
    skinCell.set(k, Math.max(skinCell.get(k) ?? -9, vz + BODY_S / 2));   // 中心 → 前面
  }

  const gaps: number[] = [];
  let miss = 0;
  for (let q = 0; q < fp.length / 3; q += 24) {          // 立方体1個 = 24頂点
    let cx = 0, cy = 0, cz = 0;
    for (let t = 0; t < 24; t++) {
      cx += fp[(q + t) * 3]; cy += fp[(q + t) * 3 + 1]; cz += fp[(q + t) * 3 + 2];
    }
    cx /= 24; cy /= 24; cz /= 24;
    const bz = skinCell.get(Math.round(cx / BODY_S) + "," + Math.round(cy / BODY_S)) ?? -9;
    if (bz < -8) { miss++; continue; }
    gaps.push((cz - MARK_S / 2) - bz);      // マスの裏面 − 肌の前面。正なら浮き
  }
  gaps.sort((a, b) => a - b);
  const mm = (v: number): string => (v * 1000).toFixed(1) + "mm";
  const mid = gaps[Math.floor(gaps.length / 2)];
  const buckets: [string, (g: number) => boolean][] = [
    ["浮き(>0.5mm)", (g) => g > 0.0005],
    ["密着(0〜3mm食い込み)", (g) => g <= 0.0005 && g >= -0.003],
    ["3〜6mm", (g) => g < -0.003 && g >= -0.006],
    ["6mm超(隠れる恐れ)", (g) => g < -0.006],
  ];
  console.log(`${jaw.padEnd(7)} マス ${gaps.length + miss}（肌が無い ${miss}）`
    + ` / 中央 ${mm(mid)} 最大 ${mm(gaps[gaps.length - 1])} 最小 ${mm(gaps[0])}`);
  console.log("        " + buckets.map(([n, f]) => `${n} ${gaps.filter(f).length}`).join(" / "));
  scene.dispose();
}
