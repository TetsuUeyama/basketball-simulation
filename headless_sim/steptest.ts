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
const S = 0.008740;
const engine = new NullEngine();
const out: Record<string, Map<number, [number, number]>> = {};
for (const jaw of ["normal", "round", "narrow"] as const) {
  const scene = new Scene(engine);
  const m = await buildRawModel(scene, "/vox/player_one", { jaw });
  const pos = m.byPart.get("body")!.getVerticesData("position")!;
  let topY = -Infinity;
  for (let i = 0; i < pos.length / 3; i++) topY = Math.max(topY, pos[i * 3 + 1]);
  const per = new Map<number, [number, number]>();   // 層 → [左端X, 右端X]
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (Math.abs(x) > 0.16 || Math.abs(z) > 0.03) continue;   // 真横のシルエット
    const L = Math.round((topY - y) / S);
    const cur = per.get(L) ?? [0, 0];
    per.set(L, [Math.min(cur[0], x), Math.max(cur[1], x)]);
  }
  out[jaw] = per;
  scene.dispose();
}
console.log("頭頂から  左端X 標準→丸顔/細あご    右端X 標準→丸顔/細あご   （段差=前の層との差）");
const ks = [...out["normal"].keys()].sort((a, b) => a - b);
for (const L of ks) {
  const d = L * S;
  if (d < 0.09 || d > 0.20) continue;
  const g = (j: string): [number, number] => out[j].get(L) ?? [0, 0];
  const p = (j: string): [number, number] => out[j].get(L - 1) ?? [0, 0];
  const step = (j: string, s: 0 | 1): string => {
    const dd = (g(j)[s] - p(j)[s]) / S;
    return Math.abs(dd) >= 1 ? `★${dd > 0 ? "+" : ""}${dd.toFixed(0)}` : "  ";
  };
  console.log(`${d.toFixed(3)}   ${g("normal")[0].toFixed(3)}→${g("round")[0].toFixed(3)}/${g("narrow")[0].toFixed(3)}`
    + ` ${step("round", 0)}${step("narrow", 0)}   `
    + `${g("normal")[1].toFixed(3)}→${g("round")[1].toFixed(3)}/${g("narrow")[1].toFixed(3)}`
    + ` ${step("round", 1)}${step("narrow", 1)}`);
}
