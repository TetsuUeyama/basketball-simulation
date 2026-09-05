// あごの形を変えても、脚・胴など顔以外が欠けていないかを確かめる。
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
const band: Record<string, [number, number]> = {
  "脚(前)": [0.30, 0.95], "腰・胴": [0.95, 1.35], "腕・肩": [1.35, 1.49],   // ⚠️ 1.50 は首の輪郭クリップの下限(頭頂-0.30)と重なる
  "首(変わってよい)": [1.49, 1.62],
};
const got: Record<string, Record<string, number>> = {};
for (const jaw of ["normal", "round", "narrow"] as JawShape[]) {
  const scene = new Scene(engine);
  const m = await buildRawModel(scene, "/vox/player_one", { jaw });
  const pos = m.byPart.get("body")!.getVerticesData("position")!;
  got[jaw] = {};
  for (const [name, [lo, hi]] of Object.entries(band)) got[jaw][name] = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (z <= 0) continue;                       // 体の前面だけ（+z が前）
    for (const [name, [lo, hi]] of Object.entries(band)) {
      if (y >= lo && y < hi) got[jaw][name]++;
    }
  }
  scene.dispose();
}
console.log("顔以外の前面の頂点数（標準と同じであるべき）");
let bad = 0;
for (const name of Object.keys(band)) {
  const n = got["normal"][name], r = got["round"][name], w = got["narrow"][name];
  const mustMatch = !name.includes("首");
  const ok = !mustMatch || (n === r && n === w);
  if (!ok) bad++;
  console.log(`  ${name.padEnd(9)} normal ${n} / round ${r} / narrow ${w}  ${ok ? (mustMatch ? "OK" : "（あごの変形で減って当然）") : "★欠けている"}`);
}
console.log(`問題のある部位: ${bad}`);
