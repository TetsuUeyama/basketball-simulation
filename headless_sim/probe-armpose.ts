// モーションを当てたときの腕の向きを測る。
// rest が T-pose（腕が真横）なので、クリップが別の rest を前提にしていると
// すべてのモーションで腕が横に広がったままになる。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";

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
const { motionClip, motionDuration, applyMotion } = await import("../vendor/objcts/player/motion/clip");

const engine = new NullEngine();
const scene = new Scene(engine);
const m = await buildRawModel(scene, "/vox/player_one");

const at = (b: string): Vector3 => {
  const n = m.rig.node(b as never);
  if (!n) return Vector3.Zero();
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition().clone();
};
/** 上腕が水平から何度下がっているか（正 = 下向き）。 */
const armDown = (side: "Left" | "Right"): number => {
  const a = at(`${side}UpperArm`), b = at(`${side}LowerArm`);
  const d = b.subtract(a);
  const horiz = Math.hypot(d.x, d.z);
  return (Math.atan2(-d.y, horiz) * 180) / Math.PI;
};
/** 手が体の中心からどれだけ横に離れているか(m)。 */
const handOut = (side: "Left" | "Right"): number => Math.abs(at(`${side}Hand`).x);

console.log("リグのボーン: " + [...m.perBone.keys()].sort().join(" "));
console.log("rest（モーションを当てる前）:");
console.log(`  上腕の下がり  左 ${armDown("Left").toFixed(1)}° / 右 ${armDown("Right").toFixed(1)}°`
  + `  手の横方向 左 ${handOut("Left").toFixed(3)}m / 右 ${handOut("Right").toFixed(3)}m`);

console.log("\nクリップ          t=0 の上腕の下がり      手の横方向     クリップ中の最小〜最大の下がり");
for (const name of (process.env.CLIPS
  ?? "idle,dribbleRun,jump,layup,passChest,shoot,defense,run").split(",")) {
  const c = motionClip(name);
  if (!c) { console.log(`  ${name}: クリップが無い`); continue; }
  const dur = motionDuration(c);
  let lo = 999, hi = -999;
  for (let k = 0; k <= 20; k++) {
    applyMotion(m.rig, c, (dur * k) / 20, { rootMotion: "vertical", leanDeg: 0 });
    const d = (armDown("Left") + armDown("Right")) / 2;
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  applyMotion(m.rig, c, 0, { rootMotion: "vertical", leanDeg: 0 });
  console.log(`  ${name.padEnd(12)} 左 ${armDown("Left").toFixed(1).padStart(6)}° 右 ${armDown("Right").toFixed(1).padStart(6)}°`
    + `   左 ${handOut("Left").toFixed(3)} 右 ${handOut("Right").toFixed(3)}`
    + `   ${lo.toFixed(1)}°〜${hi.toFixed(1)}°`);
}
console.log("\n※ 人が普通に立つと上腕は水平から 60〜80° 下がる。0°付近なら腕が真横のまま。");
