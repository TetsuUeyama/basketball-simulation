// 細い体型にしたとき、袖（jersey の腕の部分）と胴が離れていないかを測る。
// 脇の下あたりの高さで「袖の内側の端」と「胴の外側の端」の隙間を見る。
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
const S = 0.00938;      // jersey のボクセル寸法

/**
 * 高さ y の帯で、+X 側にある jersey の頂点を X で並べ、隙間の最大値を返す。
 * 袖と胴が離れると、その間に大きな空きができる。
 */
function maxGapAt(y0: number, y1: number): { gap: number; at: number; n: number } {
  const p = m.byPart.get("jersey")!.getVerticesData("position")!;
  const xs: number[] = [];
  for (let i = 0; i < p.length / 3; i++) {
    const y = p[i * 3 + 1], x = p[i * 3], z = p[i * 3 + 2];
    if (y < y0 || y > y1) continue;
    if (x < 0.05) continue;               // +X 側だけ
    if (Math.abs(z) > 0.06) continue;     // 体の中央あたりの断面
    xs.push(x);
  }
  xs.sort((a, b) => a - b);
  let gap = 0, at = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    if (d > gap) { gap = d; at = xs[i - 1]; }
  }
  return { gap, at, n: xs.length };
}

const H = 180.4;
console.log("体重   厚み倍率   脇の下(1.40〜1.46m)の隙間   肩(1.46〜1.52m)の隙間");
for (const kg of [50, 60, 75.2, 90, 99]) {
  m.setBody(H, kg);
  const a = maxGapAt(1.40, 1.46);
  const b = maxGapAt(1.46, 1.52);
  const mark = (g: number): string => (g > S * 1.5 ? " ★離れている" : "");
  console.log(`  ${String(kg).padStart(5)}kg x${m.thickness.toFixed(3)}`
    + `   ${(a.gap * 1000).toFixed(1)}mm (X=${a.at.toFixed(3)})${mark(a.gap)}`
    + `      ${(b.gap * 1000).toFixed(1)}mm${mark(b.gap)}`);
}
console.log(`\n※ ボクセル1個 ${(S * 1000).toFixed(1)}mm。その1.5倍(${(S * 1500).toFixed(0)}mm)を超えたら離れているとみなす。`);
