// あごの形（顔のバリエーション）を実測する。
// 見たいこと:
//   1. あご帯の幅・奥行きが高さごとに狙いどおり変わっているか
//   2. 帯の外（頬より上・首より下）が変わっていないか＝段差が出ていないか
//   3. setJaw() での張り直しが、最初からその形で作ったものと一致するか
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, type Mesh } from "@babylonjs/core";

const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(buf.toString("utf8")),
      arrayBuffer: async () => ab,
    };
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
};

const { buildRawModel } = await import("../src/voxraw");
type JawShape = "normal" | "round" | "narrow";
const SHAPES: JawShape[] = ["normal", "round", "narrow"];
const STEP = 0.00874;                        // ボクセル1個ぶん

type Layer = { w: number; front: number; n: number };
/** 高さの層ごとに (幅X, 顔の前端Z)。
 * ⚠️ Babylon 座標では **+z が顔の前**（Blender の -y が前、toBabylon で z = -y になる）。
 *    最初 min(z) を前端として測って「奥行きが全く変わらない」と誤読した。 */
function profile(mesh: Mesh): Map<number, Layer> {
  const pos = mesh.getVerticesData("position")!;
  const acc = new Map<number, { xs: number[]; zs: number[] }>();
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (Math.abs(x) > 0.16) continue;        // 腕・肩を除く
    const L = Math.round(y / STEP);
    let a = acc.get(L);
    if (!a) { a = { xs: [], zs: [] }; acc.set(L, a); }
    a.xs.push(x); a.zs.push(z);
  }
  const r = new Map<number, Layer>();
  for (const [L, a] of acc) {
    r.set(L, { w: Math.max(...a.xs) - Math.min(...a.xs), front: Math.max(...a.zs), n: a.xs.length });
  }
  return r;
}

const engine = new NullEngine();
const prof = new Map<JawShape, Map<number, Layer>>();
const verts = new Map<JawShape, number>();
for (const jaw of SHAPES) {
  const scene = new Scene(engine);
  const m = await buildRawModel(scene, "/vox/player_one", { jaw });
  const body = m.byPart.get("body")!;
  prof.set(jaw, profile(body));
  verts.set(jaw, body.getTotalVertices());
  scene.dispose();
}

const norm = prof.get("normal")!;
const topY = Math.max(...norm.keys()) * STEP;
console.log(`頭頂Y ${topY.toFixed(3)}  （あご帯 = 頭頂から 0.130〜0.240m）\n`);
console.log("頭頂から  幅X normal → round / narrow        変化      顔の前端Z normal → round / narrow");
const keys = [...norm.keys()].sort((a, b) => b - a);
let bandChanged = 0, outsideChanged = 0;
for (const L of keys) {
  const d = topY - L * STEP;
  if (d > 0.26) continue;
  const n = norm.get(L), r = prof.get("round")!.get(L), w = prof.get("narrow")!.get(L);
  if (!n || !r || !w) continue;
  // ⚠️ voxraw 側の帯は「ボクセル中心」基準、ここは「頂点＝角」基準なので半ボクセルずれる。
  const inBand = d >= 0.121 && d <= 0.249;
  const moved = Math.abs(r.w - n.w) > 1e-6 || Math.abs(w.w - n.w) > 1e-6
    || Math.abs(r.front - n.front) > 1e-6 || Math.abs(w.front - n.front) > 1e-6;
  if (moved) { if (inBand) bandChanged++; else outsideChanged++; }
  console.log(
    `${d.toFixed(3)}    ${n.w.toFixed(3)} → ${r.w.toFixed(3)} / ${w.w.toFixed(3)}`
    + `   ${((r.w / n.w - 1) * 100).toFixed(0).padStart(3)}% /${((w.w / n.w - 1) * 100).toFixed(0).padStart(4)}%`
    + `    ${n.front.toFixed(3)} → ${r.front.toFixed(3)} / ${w.front.toFixed(3)}`
    + `  ${inBand ? "◀あご帯" : (moved ? "★帯の外なのに変化" : "")}`);
}
console.log(`\n変化した層: あご帯の中 ${bandChanged} / 帯の外 ${outsideChanged}（0であるべき）`);
console.log(`body の頂点数: ${SHAPES.map((s) => `${s} ${verts.get(s)!.toLocaleString()}`).join(" / ")}`);

// setJaw() での張り直しが、最初からその形で作ったものと一致するか
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");
const body = m.byPart.get("body")!;
let mismatch = 0;
for (const jaw of SHAPES) {
  m.setJaw(jaw);
  const got = profile(body);
  const want = prof.get(jaw)!;
  let diff = 0;
  for (const [L, a] of want) {
    const b = got.get(L);
    if (!b || Math.abs(a.w - b.w) > 1e-6 || a.n !== b.n) diff++;
  }
  if (diff) mismatch++;
  console.log(`  setJaw("${jaw}") → 独立ビルドと違う層 ${diff} ${diff ? "★NG" : "OK"}`);
}
console.log(`張り直しの不一致: ${mismatch}`);


// 顔の長さ。あごは前へ張り出すが首は張り出さないので、
// 「前端Zが最大付近まで届く一番下の層」をあご先とみなす。
// ⚠️ 鼻はあごより前へ出ている（実測 0.122 対 0.096）。最大値を基準にすると鼻を測って
//    しまうので、あごの高さ（頭頂から0.19m）の張り出しを基準にする。
const REF_D = 0.19;
const frontAt = (sh: JawShape, dd: number): number => {
  let best = 0, bd = 9;
  for (const [L2, a] of prof.get(sh)!) {
    const d = topY - L2 * STEP;
    if (Math.abs(d - dd) < bd) { bd = Math.abs(d - dd); best = a.front; }
  }
  return best;
};
const chinOf = (sh: JawShape): number => {
  const ref = frontAt("normal", REF_D) - 0.006;
  let c = 0;
  for (const [L2, a] of prof.get(sh)!) {
    const d = topY - L2 * STEP;
    if (d < REF_D - 0.01 || d > 0.30) continue;
    if (a.front >= ref) c = Math.max(c, d);
  }
  return c;
};
console.log("\n顔の長さ（頭頂〜あご先。前へ張り出している一番下の層）");
for (const sh of SHAPES) {
  const c = chinOf(sh);
  console.log(`  ${sh.padEnd(7)} あご先は頭頂から ${c.toFixed(3)}m`
    + (sh === "normal" ? "" : ` （標準より ${((chinOf("normal") - c) * 1000).toFixed(0)}mm 短い）`));
}
// 顔と首の間に穴が空いていないか。層ごとの頂点数が前後の層に比べて急に減ったら穴。
console.log("\n顔〜首の層ごとの頂点数（急な落ち込みがあれば穴）");
for (const sh of SHAPES) {
  const pr = prof.get(sh)!;
  const rows: string[] = [];
  let holes = 0;
  const ks = [...pr.keys()].sort((a, b) => b - a);
  for (let n = 0; n < ks.length; n++) {
    const d = topY - ks[n] * STEP;
    if (d < 0.185 || d > 0.29) continue;
    const cur = pr.get(ks[n])!.n;
    const up = pr.get(ks[n - 1])?.n ?? cur, dn = pr.get(ks[n + 1])?.n ?? cur;
    const hole = cur * 3 < Math.min(up, dn);
    if (hole) holes++;
    rows.push(`${d.toFixed(3)}:${cur}${hole ? "★" : ""}`);
  }
  console.log(`  ${sh.padEnd(7)} ${rows.join(" ")}  → 穴 ${holes}`);
}
