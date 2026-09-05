// 構えの各要素が「直立度が下がるほど強くなる」かを、体の向きに依らず確かめる。
//   足の開き / 上半身の前傾 / 肩・上腕・前腕の前傾
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

/** 選手の前方向（root のヨーと numberSide の規約）。 */
function fwdOf(yaw: number, side: number): Vector3 {
  return new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(-side);
}
function pos(p: Player, b: string): Vector3 {
  const n = p.vox!.rig.node(b as never)!;
  n.computeWorldMatrix(true);
  return n.getAbsolutePosition();
}
/** ボーン a→b の「前方向の成分」(mm)。 */
function fwdOf2(p: Player, a: string, b: string, f: Vector3): number {
  const d = pos(p, b).subtract(pos(p, a));
  return (d.x * f.x + d.z * f.z) * 1000;
}

function run(t: number, side: number, yaw: number): void {
  const p = game.roster[t][0];
  const f = fwdOf(yaw, side);
  console.log(`\n== チーム${t} 番号側${side} 体の向き${(yaw * 180 / Math.PI).toFixed(0)}° ==`);
  console.log("直立度  足の間隔  胴の前傾  鎖骨の前  上腕の前  前腕の前  手の前");
  for (const u of [1.0, 0.5, 0.0]) {
    p.stand(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60;
    p.setNumberSide(side);
    p.root.rotation.y = yaw;
    p.upright = p.uprightTarget = u;
    for (let i = 0; i < 3; i++) p.sync();
    p.root.computeWorldMatrix(true);
    const feet = pos(p, "LeftFoot").subtract(pos(p, "RightFoot"));
    const hand = pos(p, "LeftHand").subtract(p.pos);
    console.log(`  ${u.toFixed(2)}  ${(feet.length() * 1000).toFixed(0).padStart(7)}mm`
      + `  ${fwdOf2(p, "Spine", "Head", f).toFixed(0).padStart(6)}mm`
      + `  ${fwdOf2(p, "LeftShoulder", "LeftUpperArm", f).toFixed(0).padStart(6)}mm`
      + `  ${fwdOf2(p, "LeftUpperArm", "LeftLowerArm", f).toFixed(0).padStart(6)}mm`
      + `  ${fwdOf2(p, "LeftLowerArm", "LeftHand", f).toFixed(0).padStart(6)}mm`
      + `  ${((hand.x * f.x + hand.z * f.z) * 1000).toFixed(0).padStart(6)}mm`);
  }
}
run(0, 1, 0);
run(1, -1, 1.2);
