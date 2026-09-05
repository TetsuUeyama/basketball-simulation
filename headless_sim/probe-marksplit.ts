// jerseymark（エンブレム・背番号・Name）が、位置でいくつの塊に分かれているかを見る。
// 背番号だけ選手ごとに差し替えられるか（＝塊として切り出せるか）の下調べ。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
const m = await buildRawModel(new Scene(new NullEngine()), "/vox/player_one");
const mesh = m.byPart.get("jerseymark")!;
const p = mesh.getVerticesData("position")!;
const S = 0.00469;   // jerseymark のボクセル寸法（scale 4）
// ボクセル中心を拾って、隣接でまとめる
const key = new Map<string, [number, number, number]>();
for (let i = 0; i < p.length / 3; i++) {
  const c = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]].map((v) => Math.round(v / S)) as [number, number, number];
  key.set(c.join(","), c);
}
const cells = [...key.values()];
const idx = new Map(cells.map((c, i) => [c.join(","), i]));
const par = cells.map((_, i) => i);
const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
for (const c of cells) {
  for (let d = 0; d < 3; d++) for (const s of [-1, 1]) {
    const n: [number, number, number] = [...c] as never; n[d] += s;
    const j = idx.get(n.join(","));
    if (j !== undefined) { const a = find(idx.get(c.join(","))!), b = find(j); if (a !== b) par[a] = b; }
  }
}
const grp = new Map<number, [number, number, number][]>();
for (const c of cells) { const r = find(idx.get(c.join(","))!); (grp.get(r) ?? grp.set(r, []).get(r)!).push(c); }
const list = [...grp.values()].sort((a, b) => b.length - a.length);
console.log(`jerseymark の塊: ${list.length} 個（頂点 ${p.length / 3}）`);
for (const g of list.slice(0, 12)) {
  const lo = [0, 1, 2].map((d) => Math.min(...g.map((c) => c[d])) * S);
  const hi = [0, 1, 2].map((d) => Math.max(...g.map((c) => c[d])) * S);
  console.log(`  ${String(g.length).padStart(5)}個  X ${lo[0].toFixed(3)}〜${hi[0].toFixed(3)}`
    + `  Y(高さ) ${lo[1].toFixed(3)}〜${hi[1].toFixed(3)}  Z ${lo[2].toFixed(3)}〜${hi[2].toFixed(3)}`
    + `  ${lo[2] > 0 ? "前" : hi[2] < 0 ? "背" : "?"}`);
}
