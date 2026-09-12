// あごの形（標準・丸顔・細あご）で実際に差が出ているかを測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, type Mesh } from "@babylonjs/core";
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
const scene = new Scene(new NullEngine());
const model = await buildRawModel(scene, { dir: DIR } as never);
if (!model) { console.log("素体が組めない"); } else {
  const body = (model.meshes as Mesh[]).find((m) => m.name.includes("body")) ?? (model.meshes as Mesh[])[0];
  /** 頭頂からの深さ d(m) における、顔の幅と奥行(cm)。 */
  const band = (d: number): { w: number; y: number; n: number } => {
    body.computeWorldMatrix(true);
    const pos = body.getVerticesData("position")!;
    let top = -Infinity;
    for (let i = 1; i < pos.length; i += 3) if (pos[i] > top) top = pos[i];
    const z = top - d;
    let xlo = 9, xhi = -9, ylo = 9, yhi = -9, n = 0;
    for (let i = 0; i < pos.length; i += 3) {
      // ⚠️ 窓はボクセル間隔(18.75mm)の半分以上。狭いと頂点が1つも入らない高さが出る。
      if (Math.abs(pos[i + 1] - z) > 0.010) continue;
      n++;
      if (pos[i] < xlo) xlo = pos[i]; if (pos[i] > xhi) xhi = pos[i];
      if (pos[i + 2] < ylo) ylo = pos[i + 2]; if (pos[i + 2] > yhi) yhi = pos[i + 2];
    }
    return { w: (xhi - xlo) * 100, y: (yhi - ylo) * 100, n };
  };
  const rows: Record<string, string[]> = {};
  const depths = [0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26];
  for (const shape of ["normal", "round", "narrow"] as const) {
    model.setJaw(shape);
    rows[shape] = depths.map((d) => {
      const b = band(d);
      return `${b.w.toFixed(1)}/${b.y.toFixed(1)}`;
    });
  }
  console.log("頭頂からの深さごとの 幅/奥行(cm)   ※あご帯は 0.130〜0.265m");
  console.log("        " + depths.map((d) => d.toFixed(2) + "m").map((s) => s.padStart(11)).join(""));
  for (const k of ["normal", "round", "narrow"]) {
    console.log(`  ${k.padEnd(7)}` + rows[k].map((s) => s.padStart(11)).join(""));
  }
  const same = rows.normal.every((v, i) => v === rows.round[i] && v === rows.narrow[i]);
  console.log(`\n3種が完全に同一: ${same ? "はい（差が出ていない）" : "いいえ"}`);
}
