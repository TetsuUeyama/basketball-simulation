// 立っているときの腕の角度を、生モデルと従来モデルで比べる。
// 静止姿勢(rest)そのものと、ゲームが立たせたときの実際の向きの両方を見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = false;
import { clubTeam } from "../src/roster";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();

const p = game.roster[0][0];
p.stand(); p.resetFacing(); p.pos.set(0, 0, 0); p.holdingBall = false;
p.curSpd = 0; p.clipName = ""; p.lastDt = 1 / 60;
for (let i = 0; i < 30; i++) p.sync();
p.root.computeWorldMatrix(true);

/** ボーン a→b のワールド方向を、真下から何度開いているかで見る。 */
function armAngle(a: string, b: string): { deg: number; d: Vector3 } | null {
  const na = p.vox!.rig.node(a as never), nb = p.vox!.rig.node(b as never);
  if (!na || !nb) return null;
  na.computeWorldMatrix(true); nb.computeWorldMatrix(true);
  const d = nb.getAbsolutePosition().subtract(na.getAbsolutePosition());
  const len = d.length();
  return { deg: Math.acos(Math.min(1, Math.max(-1, -d.y / len))) * 180 / Math.PI, d };
}
console.log("ゲームで立たせたときの腕（真下=0°、真横=90°）");
for (const [a, b, label] of [
  ["LeftShoulder", "LeftUpperArm", "鎖骨"],
  ["LeftUpperArm", "LeftLowerArm", "上腕"],
  ["LeftLowerArm", "LeftHand", "前腕"],
] as [string, string, string][]) {
  const r = armAngle(a, b);
  if (!r) { console.log(`  ${label}: 無し`); continue; }
  console.log(`  ${label.padEnd(6)} 真下から ${r.deg.toFixed(1)}°`
    + `  (x ${r.d.x.toFixed(3)} y ${r.d.y.toFixed(3)} z ${r.d.z.toFixed(3)})`);
}
// 手が体の中心からどれだけ外にあるか
const hand = p.vox!.rig.node("LeftHand" as never)!;
hand.computeWorldMatrix(true);
const hp = hand.getAbsolutePosition();
console.log(`  手の位置 x=${(hp.x - p.pos.x).toFixed(3)} y=${hp.y.toFixed(3)}`
  + `  → 体の中心から ${((hp.x - p.pos.x) * 100).toFixed(0)}cm 外`);

// ゲームが持っている「仮想の骨組み」（armPivot→elbow→wrist）は何度になっているか。
// ボクセルの骨がこれと一致していなければ、読み替えがずれている。
console.log("\nゲーム側の仮想の骨組み");
function vAngle(a: { getAbsolutePosition(): Vector3; computeWorldMatrix(f: boolean): unknown },
  b: { getAbsolutePosition(): Vector3; computeWorldMatrix(f: boolean): unknown }, label: string) {
  a.computeWorldMatrix(true); b.computeWorldMatrix(true);
  const d = b.getAbsolutePosition().subtract(a.getAbsolutePosition());
  const deg = Math.acos(Math.min(1, Math.max(-1, -d.y / d.length()))) * 180 / Math.PI;
  console.log(`  ${label.padEnd(6)} 真下から ${deg.toFixed(1)}°  (x ${d.x.toFixed(3)} y ${d.y.toFixed(3)} z ${d.z.toFixed(3)})`);
  return deg;
}
vAngle(p.armPivotL, p.elbowL, "上腕");
vAngle(p.elbowL, p.wristL, "前腕");
p.wristL.computeWorldMatrix(true);
const w = p.wristL.getAbsolutePosition();
console.log(`  手首の位置 x=${(w.x - p.pos.x).toFixed(3)} y=${w.y.toFixed(3)}`
  + `  → 体の中心から ${((w.x - p.pos.x) * 100).toFixed(0)}cm 外`);
