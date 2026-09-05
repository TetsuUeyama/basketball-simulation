// 立ち姿の骨格を測る。肩（鎖骨）と上腕がどちらを向いているか、従来モデルと比べる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { buildVoxelBody } = await import("../src/objects/player/player-voxel");
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const KIT = { top: { r: .8, g: .1, b: .1 }, bottom: { r: .8, g: .1, b: .1 }, shoes: { r: 1, g: 1, b: 1 } };
const LOOK = { skin: { r: .8, g: .6, b: .5 }, hair: { r: .1, g: .1, b: .1 } };

/** 骨 a→b の向きを「真下から何度開いているか」と「どの方向へ」で見る。 */
function seg(rig: { restPosition(b: never): Vector3 | null }, a: string, b: string) {
  const p = rig.restPosition(a as never), q = rig.restPosition(b as never);
  if (!p || !q) return null;
  const d = q.subtract(p);
  const len = d.length();
  const down = Math.acos(Math.min(1, Math.max(-1, -d.y / len))) * 180 / Math.PI;  // 真下(-Y)からの角度
  const side = Math.atan2(Math.abs(d.x), Math.abs(d.z)) * 180 / Math.PI;          // 横向き成分
  return { len, down, side, d };
}
for (const [label, rig] of [
  ["生モデル", buildRawVoxelBody(scene, new TransformNode("r", scene), {
    name: "r", balance: 50, height: 1.8, weight: 75, ...LOOK, hairNo: 0, kit: KIT, jerseyText: "8" })!.rig],
  ["従来モデル", buildVoxelBody(scene, new TransformNode("b", scene), {
    name: "b", balance: 50, height: 1.8, ...LOOK, hairNo: 0, kit: KIT, jerseyText: "8" }).rig],
] as [string, { restPosition(b: never): Vector3 | null }][]) {
  console.log(`\n== ${label} ==`);
  for (const [a, b] of [
    ["Chest", "LeftShoulder"], ["LeftShoulder", "LeftUpperArm"],
    ["LeftUpperArm", "LeftLowerArm"], ["LeftLowerArm", "LeftHand"],
  ] as [string, string][]) {
    const r = seg(rig, a, b);
    if (!r) { console.log(`  ${a}→${b}: 無し`); continue; }
    console.log(`  ${(a + "→" + b).padEnd(26)} 長さ ${(r.len * 100).toFixed(1)}cm`
      + `  真下から ${r.down.toFixed(0)}°`
      + `  (x ${r.d.x.toFixed(3)} y ${r.d.y.toFixed(3)} z ${r.d.z.toFixed(3)})`);
  }
  const sh = rig.restPosition("LeftUpperArm" as never)!;
  const hip = rig.restPosition("LeftUpperLeg" as never)!;
  console.log(`  肩の左右位置 x=${sh.x.toFixed(3)} / 股関節 x=${hip.x.toFixed(3)}`
    + `  → 肩幅は股関節の ${(Math.abs(sh.x / hip.x)).toFixed(2)} 倍`);
}
