// 書き出した GLB に穴（面が1枚しか付いていない辺）が残っていないかを直接数える。
// ⚠️ 中間状態ではなく**出力そのもの**を見る。
import { readFileSync } from "node:fs";
type Acc = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string };
function glb(p: string): { json: Record<string, unknown>; bin: Buffer } {
  const b = readFileSync(p);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString("utf8")) as Record<string, unknown>;
  let o = 20 + jl;
  const bl = b.readUInt32LE(o);
  return { json, bin: b.subarray(o + 8, o + 8 + bl) };
}
function read(j: Record<string, unknown>, bin: Buffer, i: number): number[] {
  const acc = (j.accessors as Acc[])[i];
  const bv = (j.bufferViews as { byteOffset?: number; byteStride?: number }[])[acc.bufferView!];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType]!;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type]!;
  const stride = bv.byteStride ?? n * comps;
  const out: number[] = [];
  for (let k = 0; k < acc.count; k++) {
    for (let c = 0; c < comps; c++) {
      const off = base + k * stride + c * n;
      out.push(acc.componentType === 5126 ? bin.readFloatLE(off)
        : acc.componentType === 5125 ? bin.readUInt32LE(off)
        : acc.componentType === 5123 ? bin.readUInt16LE(off) : bin.readUInt8(off));
    }
  }
  return out;
}
for (const file of process.argv.slice(2)) {
  const { json, bin } = glb(file);
  const meshes = json.meshes as { name?: string; primitives: { indices?: number; attributes: Record<string, number> }[] }[];
  let tri = 0;
  // ⚠️ プリミティブごとに数えてはいけない。glTF はマテリアルごとにメッシュを分けるので、
  //    マテリアルの境目が「片側だけの辺」に見えて穴と誤判定する
  //    （実測: それで 282 本と出たが、実際の穴は一部だった）。
  //    メッシュ全体で、位置で丸めた頂点番号を使って数える。
  const key = new Map<string, number>();
  const cnt = new Map<string, number>();
  const pt: number[][] = [];
  const idOf = (x: number, y: number, z: number): number => {
    const k = `${Math.round(x*1e4)},${Math.round(y*1e4)},${Math.round(z*1e4)}`;
    let id = key.get(k);
    if (id === undefined) { id = key.size; key.set(k, id); pt.push([x, y, z]); }
    return id;
  };
  for (const m of meshes) {
    for (const p of m.primitives) {
      if (p.indices === undefined) continue;
      const idx = read(json, bin, p.indices);
      const pos = read(json, bin, p.attributes.POSITION);
      const w = new Int32Array(pos.length / 3);
      for (let v = 0; v < pos.length / 3; v++) w[v] = idOf(pos[v*3], pos[v*3+1], pos[v*3+2]);
      for (let t = 0; t < idx.length; t += 3) {
        tri++;
        for (let e = 0; e < 3; e++) {
          const x = w[idx[t + e]], y = w[idx[t + (e + 1) % 3]];
          const k = x < y ? `${x}_${y}` : `${y}_${x}`;
          cnt.set(k, (cnt.get(k) ?? 0) + 1);
        }
      }
    }
  }
  let open = 0;
  const openPts: number[][] = [];
  for (const [k, c] of cnt) {
    if (c !== 1) continue;
    open++;
    openPts.push(pt[Number(k.split("_")[0])]);
  }
  console.log(`${file.split("/").pop()}: 三角形 ${tri.toLocaleString()} / 穴の辺 ${open} 本`);
  if (openPts.length) {
    const hi = openPts.filter((p) => p[1] > 1.5);   // 頭の高さ帯
    console.log(`  うち頭の高さ(y>1.5m) ${hi.length} 本`);
    if (hi.length) {
      const ys = hi.map((p) => p[1]).sort((a, b) => a - b);
      console.log(`    y ${ys[0].toFixed(3)}〜${ys[ys.length-1].toFixed(3)}`);
    }
  }
}
