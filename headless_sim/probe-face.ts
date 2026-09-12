// 今の顔がどうなっているかを、出力 GLB から直接測る。
//  ・目と口のあたりに穴が残っているか
//  ・顔の横顔の形（鼻の出っ張りが残っているか、なめらかか）
import { readFileSync } from "node:fs";
type Acc = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string };
function glb(p: string): { json: Record<string, unknown>; bin: Buffer } {
  const b = readFileSync(p);
  const jl = b.readUInt32LE(12);
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
  for (let k = 0; k < acc.count; k++)
    for (let c = 0; c < comps; c++) {
      const off = base + k * stride + c * n;
      out.push(acc.componentType === 5126 ? bin.readFloatLE(off)
        : acc.componentType === 5125 ? bin.readUInt32LE(off)
        : acc.componentType === 5123 ? bin.readUInt16LE(off) : bin.readUInt8(off));
    }
  return out;
}
for (const file of process.argv.slice(2)) {
  const { json, bin } = glb(file);
  const meshes = json.meshes as { primitives: { indices?: number; attributes: Record<string, number> }[] }[];
  const key = new Map<string, number>(); const pt: number[][] = [];
  const cnt = new Map<string, number>();
  const id = (x: number, y: number, z: number): number => {
    const k = `${Math.round(x*1e4)},${Math.round(y*1e4)},${Math.round(z*1e4)}`;
    let v = key.get(k);
    if (v === undefined) { v = key.size; key.set(k, v); pt.push([x, y, z]); }
    return v;
  };
  for (const m of meshes) for (const p of m.primitives) {
    if (p.indices === undefined) continue;
    const idx = read(json, bin, p.indices), pos = read(json, bin, p.attributes.POSITION);
    const w = new Int32Array(pos.length / 3);
    for (let v = 0; v < pos.length / 3; v++) w[v] = id(pos[v*3], pos[v*3+1], pos[v*3+2]);
    for (let t = 0; t < idx.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = w[idx[t+e]], b = w[idx[t+(e+1)%3]];
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        cnt.set(k, (cnt.get(k) ?? 0) + 1);
      }
  }
  const openV: number[][] = [];
  for (const [k, c] of cnt) if (c === 1) openV.push(pt[Number(k.split("_")[0])]);
  console.log(`\n=== ${file.split("/").pop()} ===`);
  const box = (nm: string, y0: number, y1: number): void => {
    const n = openV.filter((p) => p[1] >= y0 && p[1] <= y1 && p[2] > 0).length;
    console.log(`  ${nm}(y ${y0}〜${y1}・前面)の穴の辺 ${n} 本`);
  };
  box("目", 1.66, 1.72); box("口", 1.62, 1.67); box("頭ぜんぶ", 1.50, 1.90);
  // ⚠️ 中心の帯だけ見てはいけない。目は左右 3〜4cm にあるので、
  //    中心だけだと鼻すじを測っているだけで目のくぼみを見逃す（実際に見逃した）。
  //    顔全体を格子で見て、まわりより引っ込んでいる所を探す。
  const GX = 15, GZ = 13;   // x: -7〜+7cm, z: 1.57〜1.75m
  const depth: number[][] = Array.from({ length: GZ }, () => new Array<number>(GX).fill(NaN));
  for (const p of pt) {
    if (p[2] <= 0) continue;
    const ix = Math.round((p[0] + 0.07) / 0.01);
    const iz = Math.round((p[1] - 1.57) / 0.015);
    if (ix < 0 || ix >= GX || iz < 0 || iz >= GZ) continue;
    if (!(depth[iz][ix] > p[2])) depth[iz][ix] = p[2];
  }
  console.log("  顔の深さ(cm) 左右 -7cm〜+7cm / 下から上へ");
  for (let iz = 0; iz < GZ; iz++) {
    const row = depth[iz].map((v) => isNaN(v) ? "  - " : (v * 100).toFixed(1).padStart(4)).join("");
    console.log(`   ${(1.57 + iz * 0.015).toFixed(3)}m ${row}`);
  }
  // まわりより引っ込んでいる量（くぼみ）
  let worst = 0, wx = 0, wz = 0;
  for (let iz = 1; iz < GZ - 1; iz++) for (let ix = 1; ix < GX - 1; ix++) {
    const c = depth[iz][ix];
    const n = [depth[iz-1][ix], depth[iz+1][ix], depth[iz][ix-1], depth[iz][ix+1]];
    if (isNaN(c) || n.some(isNaN)) continue;
    const d = (n.reduce((a2, b2) => a2 + b2, 0) / 4) - c;
    if (d > worst) { worst = d; wx = -7 + ix; wz = 1.57 + iz * 0.015; }
  }
  console.log(`  まわりより一番引っ込んでいる所 ${(worst * 1000).toFixed(1)}mm (x ${wx}cm, y ${wz.toFixed(3)}m)`);

}
