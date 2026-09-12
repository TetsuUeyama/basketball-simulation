// 首から下が元モデルのままか。高さごとの胴の幅を2つの GLB で比べる。
import { readFileSync } from "node:fs";
type Acc = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string };
function glb(p: string): { json: Record<string, unknown>; bin: Buffer } {
  const b = readFileSync(p); const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString("utf8")) as Record<string, unknown>;
  const o = 20 + jl;
  return { json, bin: b.subarray(o + 8, o + 8 + b.readUInt32LE(o)) };
}
function read(j: Record<string, unknown>, bin: Buffer, i: number): number[] {
  const acc = (j.accessors as Acc[])[i];
  const bv = (j.bufferViews as { byteOffset?: number; byteStride?: number }[])[acc.bufferView!];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType]!;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type]!;
  const stride = bv.byteStride ?? n * comps;
  const out: number[] = [];
  for (let k = 0; k < acc.count; k++) for (let c = 0; c < comps; c++) {
    const off = base + k * stride + c * n;
    out.push(acc.componentType === 5126 ? bin.readFloatLE(off)
      : acc.componentType === 5125 ? bin.readUInt32LE(off)
      : acc.componentType === 5123 ? bin.readUInt16LE(off) : bin.readUInt8(off));
  }
  return out;
}
function widths(file: string): Map<number, number> {
  const { json, bin } = glb(file);
  const meshes = json.meshes as { primitives: { attributes: Record<string, number> }[] }[];
  const w = new Map<number, [number, number]>();
  for (const m of meshes) for (const p of m.primitives) {
    const pos = read(json, bin, p.attributes.POSITION);
    for (let v = 0; v < pos.length / 3; v++) {
      const y = pos[v*3+1], x = pos[v*3];
      // ⚠️ 腕まで入れると、端の点がバケットをまたぐだけで幅が大きく変わる。胴だけ見る。
      if (Math.abs(x) > 0.30) continue;
          const k = Math.round(y * 100) / 100;   // 1cm 刻み
      const cur = w.get(k);
      if (!cur) w.set(k, [x, x]);
      else { if (x < cur[0]) cur[0] = x; if (x > cur[1]) cur[1] = x; }
    }
  }
  const out = new Map<number, number>();
  for (const [k, v] of w) out.set(k, v[1] - v[0]);
  return out;
}
const a = widths(process.argv[2]), b = widths(process.argv[3]);
console.log("高さ   元モデル  のっぺらぼう   差");
let worst = 0, worstY = 0;
for (const y of [...a.keys()].filter((y) => y >= 0.9 && y <= 1.62).sort((p, q) => p - q)) {
  const va = a.get(y)!, vb = b.get(y);
  if (vb === undefined) continue;
  const d = Math.abs(va - vb) * 1000;
  if (d > worst) { worst = d; worstY = y; }
  if (y >= 1.30) console.log(`  ${y.toFixed(2)}m  ${(va*100).toFixed(1)}cm   ${(vb*100).toFixed(1)}cm   ${d.toFixed(1)}mm`);
}
console.log(`\n首から下(0.9〜1.62m)で一番ずれている所: ${worst.toFixed(1)}mm (y ${worstY.toFixed(2)}m)`);
