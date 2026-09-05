// 首まわりで「向こうが透けて見える」場所をレイで直接探す。
// 方位ごとに外から中心へレイを飛ばし、body / jersey / どれにも当たらなければ穴。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Ray } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildRawModel } = await import("../src/voxraw");
type JawShape = "normal" | "round" | "narrow";

const engine = new NullEngine();
for (const jaw of ["normal", "round", "narrow"] as JawShape[]) {
  const scene = new Scene(engine);
  const m = await buildRawModel(scene, "/vox/player_one", { jaw });
  for (const mesh of m.meshes) { mesh.computeWorldMatrix(true); mesh.refreshBoundingInfo(); }
  const solid = m.meshes.filter((x) => !/hairstyle_/.test(x.name));
  const topY = m.byPart.get("body")!.getBoundingInfo().boundingBox.maximumWorld.y;
  const AZ = 48;
  const rows: string[] = [];
  let holes = 0;
  for (let d = 0.19; d <= 0.30; d += 0.00874) {
    const y = topY - d;
    let miss = 0;
    const dirs: number[] = [];
    for (let a = 0; a < AZ; a++) {
      const th = (a / AZ) * Math.PI * 2;
      // 水平やや見下ろし（襟の中を覗く角度）
      for (const pitch of [0, -0.35]) {
        const from = new Vector3(Math.cos(th) * 0.8, y - Math.sin(pitch) * 0.8, Math.sin(th) * 0.8);
        const to = new Vector3(0, y, 0);
        const dir = to.subtract(from).normalize();
        const ray = new Ray(from, dir, 2);
        let hit = false;
        for (const mesh of solid) { if (ray.intersectsMesh(mesh, false).hit) { hit = true; break; } }
        if (!hit) { miss++; dirs.push(a); break; }
      }
    }
    if (miss) { holes++; rows.push(`${d.toFixed(3)}m: ${miss}/${AZ}方位 (${dirs.slice(0, 8).join(",")})`); }
  }
  console.log(`${jaw.padEnd(7)} 透けている高さ ${holes} 箇所`);
  for (const r of rows) console.log(`    ${r}`);
  scene.dispose();
}
