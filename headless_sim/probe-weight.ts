// 体重による厚みを実測する。体の部位ごとの横幅が、狙いどおりに変わるか。
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

const engine = new NullEngine();
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");

/** 高さ y のあたりでの、指定パーツの横幅・前後の厚み。 */
function slab(part: string, y0: number, y1: number): { w: number; d: number; n: number } {
  const mesh = m.byPart.get(part);
  if (!mesh) return { w: 0, d: 0, n: 0 };
  const p = mesh.getVerticesData("position")!;
  let x0 = 9, x1 = -9, z0 = 9, z1 = -9, n = 0;
  for (let i = 0; i < p.length / 3; i++) {
    const y = p[i * 3 + 1];
    if (y < y0 || y > y1) continue;
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    z0 = Math.min(z0, p[i * 3 + 2]); z1 = Math.max(z1, p[i * 3 + 2]);
    n++;
  }
  return n ? { w: x1 - x0, d: z1 - z0, n } : { w: 0, d: 0, n: 0 };
}
/** 頭の横幅（変わらないはず）。 */
const headW = (): number => slab("body", 1.70, 1.78).w;
/** 胴の横幅と前後の厚み。
 * ⚠️ 高さ 1.35〜1.45 で測ると**袖**が混ざる（そこでの jersey の幅は 0.75m）。
 *    袖の無い 1.15〜1.25m で測ること。 */
const chest = (): { w: number; d: number } => {
  const s = slab("jersey", 1.15, 1.25);
  return { w: s.w, d: s.d };
};
/** 太もも。 */
const thigh = (): { w: number; d: number } => {
  const s = slab("shorts", 0.85, 0.95);
  return { w: s.w, d: s.d };
};

const H = 180.4;
console.log(`身長 ${H}cm 固定で体重を変える（BMI 23.1 = ${(23.1 * (H / 100) ** 2).toFixed(1)}kg が基準）`);
console.log("体重    BMI   厚み倍率   胴の幅   胴の厚み  太ももの幅  頭の幅");
for (const kg of [55, 65, 75.2, 85, 95]) {
  m.setBody(H, kg);
  const c = chest(), t = thigh();
  const bmi = kg / (H / 100) ** 2;
  console.log(`  ${String(kg).padStart(5)}kg ${bmi.toFixed(1)}  x${m.thickness.toFixed(3)}`
    + `   ${c.w.toFixed(3)}   ${c.d.toFixed(3)}    ${t.w.toFixed(3)}     ${headW().toFixed(3)}`);
}
console.log("\n※ 頭の幅は体重で変わらないのが正しい（THICK_BY_BONE で Head/Neck を 0 にしている）。");
