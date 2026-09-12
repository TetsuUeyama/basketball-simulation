// 顔の面が裏返っていないかを数える。裏返っていると外から見えず「開いて」見える。
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
for (const file of process.argv.slice(2)) {
  const { json, bin } = glb(file);
  const meshes = json.meshes as { primitives: { indices?: number; attributes: Record<string, number> }[] }[];
  let face = 0, flipped = 0, noNormal = 0;
  for (const m of meshes) for (const p of m.primitives) {
    if (p.indices === undefined) continue;
    const idx = read(json, bin, p.indices), pos = read(json, bin, p.attributes.POSITION);
    const nrm = p.attributes.NORMAL !== undefined ? read(json, bin, p.attributes.NORMAL) : null;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t+1], c = idx[t+2];
      const cx = (pos[a*3]+pos[b*3]+pos[c*3])/3, cy = (pos[a*3+1]+pos[b*3+1]+pos[c*3+1])/3,
            cz = (pos[a*3+2]+pos[b*3+2]+pos[c*3+2])/3;
      if (cy < 1.57 || cy > 1.76 || cz < 0.02) continue;   // 顔の前面だけ
      face++;
      // 巻き順から出る面の向き
      const ux = pos[b*3]-pos[a*3], uy = pos[b*3+1]-pos[a*3+1], uz = pos[b*3+2]-pos[a*3+2];
      const vx = pos[c*3]-pos[a*3], vy = pos[c*3+1]-pos[a*3+1], vz = pos[c*3+2]-pos[a*3+2];
      const gx = uy*vz-uz*vy, gy = uz*vx-ux*vz, gz = ux*vy-uy*vx;
      // ⚠️ 「+Z 向きか」では判定できない（曲面なので元モデルでも 17.9%% 出る）。
      //    巻き順から出る向きと、**格納されている法線**が食い違っているかで見る。
      //    食い違っていれば、その面は外から見えない（＝穴が開いて見える）。
      if (!nrm) { noNormal++; continue; }
      const nx = (nrm[a*3]+nrm[b*3]+nrm[c*3])/3;
      const ny = (nrm[a*3+1]+nrm[b*3+1]+nrm[c*3+1])/3;
      const nz = (nrm[a*3+2]+nrm[b*3+2]+nrm[c*3+2])/3;
      if (gx*nx + gy*ny + gz*nz < 0) flipped++;
    }
  }
  console.log(`${file.split("/").pop()}: 顔の前面の三角形 ${face} 枚 / 法線と巻き順の食い違い ${flipped} 枚`
    + ` (${(flipped/Math.max(1,face)*100).toFixed(1)}%)`);
}
