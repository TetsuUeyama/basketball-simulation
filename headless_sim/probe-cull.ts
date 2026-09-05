// 隠れた面の間引きで「見える面」まで消していないかを確かめる。
// 間引き無しの版に外周からレイを当てて基準を取り、間引き版で同じ所に当たるかを見る。
// 当たる位置が変わらなければ、消したのは外から見えない面だけ。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Ray, type Mesh } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");

type Opt = { noCavityCull?: boolean; noHiddenCull?: boolean };
async function build(o: Opt) {
  const scene = new Scene(new NullEngine());
  const m = await buildRawModel(scene, "/vox/player_one", o);
  await m.loadHair("hairstyle_001");
  for (const mesh of m.meshes) {
    (mesh as Mesh).isPickable = true;
    mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo();
  }
  return { scene, m };
}

const R = 3;                       // 半径3mの球から中心へ向けて飛ばす
const TOL = 0.004;                 // 4mm（面1枚ぶんの厚み）
const B = await build({ noCavityCull: true, noHiddenCull: true });
const shots: { from: Vector3; dir: Vector3; dist: number; name: string }[] = [];
for (let i = 0; i < 6000; i++) {
  const u = (i + 0.5) / 6000, phi = Math.acos(1 - 2 * u), th = Math.PI * (1 + Math.sqrt(5)) * i;
  const d = new Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
  const target = new Vector3((i % 7 - 3) * 0.06, 0.15 + ((i * 37) % 100) / 100 * 1.7, (i % 5 - 2) * 0.05);
  const from = target.add(d.scale(R));
  const dir = target.subtract(from).normalize();
  const hb = B.scene.pickWithRay(new Ray(from, dir, R * 2));
  if (hb?.hit) shots.push({ from, dir, dist: hb.distance, name: hb.pickedMesh?.name ?? "" });
}
console.log(`間引き無し: 三角形 ${(B.m.triangles / 1000).toFixed(0)}k / 外から当たったレイ ${shots.length} 本\n`);


const CASES: [string, Opt][] = [
  ["空洞向きだけ（本番）", {}],
  ["間引き無し", { noCavityCull: true }],
];
for (const [label, opt] of CASES) {
  const A = await build(opt);
  let diff = 0, worst = 0, miss = 0;
  const where = new Map<string, number>();
  for (const sh of shots) {
    const ha = A.scene.pickWithRay(new Ray(sh.from, sh.dir, R * 2));
    if (!ha?.hit) { miss++; diff++; where.set(sh.name, (where.get(sh.name) ?? 0) + 1); continue; }
    const e = Math.abs(ha.distance - sh.dist);
    if (e > TOL) {
      diff++; if (e > worst) worst = e;
      where.set(sh.name, (where.get(sh.name) ?? 0) + 1);
    }
  }
  const top = [...where].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${label.padEnd(18)} 三角形 ${(A.m.triangles / 1000).toFixed(0)}k`
    + `  見え方が変わったレイ ${diff}/${shots.length}(消失 ${miss})`
    + (diff ? `  最大 ${(worst * 1000).toFixed(1)}mm ★  ${top}` : "  → 見える面は消えていない"));
  A.scene.dispose();
}
