// 顔のパレット（目 3列×2段 / 口 3列×1段）と、その上に描く 1/4 サイズの絵を測る。
// ⚠️ 確認ページと同じ経路（rawPrototype → buildRawVoxelBody）で組むこと。
//    buildRawModel を直に呼ぶと、ページが使わないメッシュを測ってしまう。
// ⚠️ 肌の面は**前を向いた三角形に点が入るか**で測る。Ray.intersectsMesh は一定して
//    20.5mm 奥を返し、頂点を x で拾う測り方は隣の列（鼻）の角を拾って1ボクセル前にずれる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, rawPrototype } = await import("../src/objects/player/player-raw");
const { setMarkDebug } = await import("../src/voxraw");
await startRawPreload();
const engine = new NullEngine();
const scene = new Scene(engine);
new TransformNode("p", scene);
const S = 0.0187504074790261;
const mm = (v: number): string => (v * 1000).toFixed(1);

/** 立方体1つ。1個 = 6面 × 4頂点 = 24頂点。 */
type Box = { x: number; y: number; zF: number; zB: number; w: number; h: number; col: string };
function boxes(m: { getVerticesData(k: string): Float32Array | number[] | null }): Box[] {
  const p = m.getVerticesData("position")!, c = m.getVerticesData("color");
  const out: Box[] = [];
  for (let i = 0; i < p.length / 3; i += 24) {
    let sx = 0, sy = 0, zF = -Infinity, zB = Infinity;
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
    for (let k = 0; k < 24; k++) {
      const x = p[(i + k) * 3], y = p[(i + k) * 3 + 1], z = p[(i + k) * 3 + 2];
      sx += x; sy += y;
      zF = Math.max(zF, z); zB = Math.min(zB, z);
      xLo = Math.min(xLo, x); xHi = Math.max(xHi, x);
      yLo = Math.min(yLo, y); yHi = Math.max(yHi, y);
    }
    out.push({
      x: sx / 24, y: sy / 24, zF, zB, w: xHi - xLo, h: yHi - yLo,
      col: c ? [0, 1, 2].map((j) => Math.round(c[i * 4 + j] * 255)).join(",") : "",
    });
  }
  return out;
}

// 目6形 × 口6形 × 位置で測る。位置をずらしても全部出るか、左右対称かを見る。
// ⚠️ 黒目1マスの形は幅7マス（奇数）。升目は12マス（偶数）なので絵は升目の中心から
//    半マスずれるが、反対の目は列を反転して貼るので**顔の中心線から見れば左右対称**。
const CASES = [
  [false, "up", 0, 0, "wide"], [false, "down", 0, 0, "line"], [false, "rect", 0, 0, "small"],
  [false, "upS", 0, 0, "smile"], [false, "downS", 0, 0, "frown"], [false, "rectS", 0, 0, "open"],
  [false, "inner", 0, 0, "wide"], [false, "inner", 1, 2, "wide"], [false, "inner", -1, -2, "wide"],
  [false, "tall", 0, 0, "wide"], [false, "tall", 3, 1, "wide"], [false, "tall", -3, -1, "wide"],
  [false, "innerO1", 0, 0, "wide"], [false, "innerO2", 0, 0, "wide"],
  [false, "innerO4", 0, 0, "wide"], [false, "innerO6", 0, 0, "wide"],
  [false, "upS", 2, 2, "wide"], [false, "rectS", -2, -2, "wide"],
  [true, "up", 0, 0, "wide"],
] as const;
for (const [dbg, shape, ox, oy, mouth] of CASES) {
  // ⚠️ 顔は選手ごとの持ち物になったので、グローバル設定ではなく variant で作る。
  setMarkDebug(dbg);
  const proto = rawPrototype(scene, 1.804, 75)!;
  const fm = proto.variant({ jaw: "normal", eye: shape, eyeX: ox, eyeY: oy, mouth }).face;
  if (!fm) { console.log("顔のメッシュが無い"); break; }
  const bs = boxes(fm as never);
  console.log("\n=== 形 " + (shape === "up" ? "半円(曲線が上)"
    : shape === "down" ? "半円(曲線が下)" : shape === "rect" ? "長方形(四隅なし)"
    : shape === "upS" ? "半円上・黒目1" : shape === "downS" ? "半円下・黒目1"
    : shape === "rectS" ? "長方形・黒目1" : shape === "inner" ? "内寄り"
    : shape === "tall" ? "縦長" : shape)
    + " / 口 " + mouth
    + " / 位置 外" + (ox >= 0 ? "+" : "") + ox + " 上" + (oy >= 0 ? "+" : "") + oy
    + " / 確認色 " + (dbg ? "ON" : "OFF") + " : 絵のボクセル " + bs.length + "個 / 1個 "
    + mm(bs[0].w) + "×" + mm(bs[0].h) + "mm（body の 1/" + (S / bs[0].w).toFixed(0) + "） ===");
  const cols = new Map<string, number>();
  for (const b of bs) cols.set(b.col, (cols.get(b.col) ?? 0) + 1);
  console.log("色:", [...cols].map(([k, n]) => `${k} × ${n}`).join(" / "));
  // ⚠️ 数だけでは虹彩を動かした形の違いが出ない（白と入れ替えるので総数が同じ）。
  //    左目（x>0 側）の色ごとの x の範囲も出す。
  {
    const L = bs.filter((b) => b.y > 1.68 && b.x > 0);
    const byCol = new Map<string, Box[]>();
    for (const b of L) {
      if (!byCol.has(b.col)) byCol.set(b.col, []);
      byCol.get(b.col)!.push(b);
    }
    console.log("左目の色ごとの x: " + [...byCol].map(([k, g]) =>
      k + " " + mm(Math.min(...g.map((b) => b.x - b.w / 2)))
      + "〜" + mm(Math.max(...g.map((b) => b.x + b.w / 2))) + "mm").join(" / "));
  }
  if (dbg) continue;

  const body = proto.byPart.get("body")!;
  const P = body.getVerticesData("position")!;
  const I = body.getIndices()!;
  /** (x, y) で前を向いた三角形のうち一番手前の z。 */
  const skin = (x: number, y: number): number | null => {
    let best: number | null = null;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const za = P[a + 2];
      if (Math.abs(za - P[b + 2]) > 1e-6 || Math.abs(za - P[c + 2]) > 1e-6) continue;
      const x1 = P[a], y1 = P[a + 1], x2 = P[b], y2 = P[b + 1], x3 = P[c], y3 = P[c + 1];
      const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
      const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
      if (l1 < -1e-9 || l2 < -1e-9 || 1 - l1 - l2 < -1e-9) continue;
      if (best === null || za > best) best = za;
    }
    return best;
  };
  let top = -Infinity;
  for (let i = 0; i < P.length / 3; i++) top = Math.max(top, P[i * 3 + 1]);

  // --- 絵のかたまりを y でまとめて、段ごとに出す ---
  const ys = [...new Set(bs.map((b) => Math.round(b.y / bs[0].h)))].sort((a, b) => b - a);
  console.log(`絵の段数 ${ys.length}（目 8段 + 口 4段のうち、描くマスがある段だけ）`);
  let floats = 0, buried = 0, worstGap = -Infinity;
  for (const iy of ys) {
    const r = bs.filter((b) => Math.round(b.y / b.h) === iy).sort((a, b) => a.x - b.x);
    const sfs = r.map((b) => skin(b.x, b.y));
    for (let i = 0; i < r.length; i++) {
      const sf = sfs[i];
      if (sf === null) continue;
      const gap = r[i].zB - sf;                 // + なら浮き、- なら食い込み
      worstGap = Math.max(worstGap, gap);
      if (gap > 1e-6) floats++;
      if (r[i].zF - sf < 1e-6) buried++;
    }
    console.log(`  頭頂から ${((top - r[0].y) * 100).toFixed(2)}cm  ${r.length}個`
      + `  x ${mm(Math.min(...r.map((b) => b.x - b.w / 2)))}〜${mm(Math.max(...r.map((b) => b.x + b.w / 2)))}mm`
      + `  前面 ${mm(r[0].zF)}mm（ばらつき ${mm(Math.max(...r.map((b) => b.zF)) - Math.min(...r.map((b) => b.zF)))}mm）`
      + `  肌 ${mm(Math.min(...sfs.filter((v): v is number => v !== null)))}〜${mm(Math.max(...sfs.filter((v): v is number => v !== null)))}mm`);
  }
  console.log(`肌から浮いた絵 ${floats}個 / 肌に埋まった絵 ${buried}個 / 隙間 最大 ${mm(worstGap)}mm`);

  // --- パレットが平らか。絵の位置からパレットの矩形を割り出して測る ---
  // ⚠️ 絵は升目の上下の縁まで描いていない（半円の外は空き）ので、絵の外周に1マス足す。
  //    横は半円の平らな辺が縁まで届くので、その1マスぶんは升目の外を測ることになる
  //    （＝平らかどうかの判定は少し厳しい側に出る）。
  const q = bs[0].w;
  const eyeCx = (Math.min(...bs.map((b) => b.x)) + Math.max(...bs.map((b) => b.x))) / 2;
  const groups: [string, Box[]][] = [
    ["右目", bs.filter((b) => b.y > 1.70 && b.x < eyeCx)],
    ["左目", bs.filter((b) => b.y > 1.70 && b.x > eyeCx)],
    ["口", bs.filter((b) => b.y < 1.70)],
  ];
  console.log("パレットの面（升目の中を 6×4 点で測る）");
  for (const [name, g] of groups) {
    const x0 = Math.min(...g.map((b) => b.x)) - q, x1 = Math.max(...g.map((b) => b.x)) + q;
    const y0 = Math.min(...g.map((b) => b.y)) - q, y1 = Math.max(...g.map((b) => b.y)) + q;
    const vals: number[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        const v = skin(x0 + (x1 - x0) * (i + 0.5) / 6, y0 + (y1 - y0) * (j + 0.5) / 4);
        if (v !== null) vals.push(v);
      }
    }
    const lo = Math.min(...vals), hi = Math.max(...vals);
    console.log("  " + name + "  x " + mm(x0) + "〜" + mm(x1) + "mm"
      + "  y " + (y0 * 100).toFixed(2) + "〜" + (y1 * 100).toFixed(2) + "cm"
      + "  面 " + mm(lo) + "〜" + mm(hi) + "mm  ばらつき " + mm(hi - lo) + "mm（" + vals.length + "点）");
  }

  // --- 左右対称（軸は顔そのものの中心） ---
  const eb = bs.filter((b) => b.y > 1.70);
  const cx = (Math.min(...eb.map((b) => b.x - b.w / 2)) + Math.max(...eb.map((b) => b.x + b.w / 2))) / 2;
  let worstSym = 0;
  for (const b of bs) {
    const want = 2 * cx - b.x;
    const mate = bs.filter((o) => Math.abs(o.y - b.y) < 1e-6 && o.col === b.col)
      .reduce((best, o) => Math.abs(o.x - want) < Math.abs(best.x - want) ? o : best, bs[0]);
    worstSym = Math.max(worstSym, Math.abs(mate.x - want));
  }
  console.log(`左右対称の軸 x=${mm(cx)}mm / ずれ 最大 ${mm(worstSym)}mm`);
}
