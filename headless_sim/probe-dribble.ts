// ドリブル中の① 手のひらが床と平行か ② 空いている手が振れる／相手へ伸びるか。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Matrix, Quaternion } from "@babylonjs/core";
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

// 実測した静止姿勢での手のひらの法線（dribble.ts と同じ値）
const PALM_N: Record<string, Vector3> = {
  LeftHand: new Vector3(0.263, -0.904, -0.338),
  RightHand: new Vector3(-0.279, -0.885, -0.373),
};
const UP = new Vector3(0, 1, 0);
/** 手のひらが水平からどれだけ傾いているか（0° = 床と平行）。 */
function palmTilt(p: Player, bone: string): number {
  const n = p.vox!.rig.node(bone as never)!;
  n.computeWorldMatrix(true);
  const m = n.getWorldMatrix();
  const o = Vector3.TransformCoordinates(Vector3.Zero(), m);
  const nrm = Vector3.TransformCoordinates(PALM_N[bone], m).subtract(o).normalize();
  // 法線が真上/真下を向いていれば手のひらは水平。0° = 床と平行。
  return Math.acos(Math.min(1, Math.abs(Vector3.Dot(nrm, UP)))) * 180 / Math.PI;
}
void Matrix; void Quaternion;

// ⚠️ 他の選手が近くに居ると、そちらが「近い相手」に選ばれて条件が混ざる。全員どかす。
for (const t of [0, 1]) for (let i = 0; i < game.roster[t].length; i++) {
  game.roster[t][i].pos.set(40 + i, 0, 40 + t * 5);
}
for (const [side, yaw] of [[1, 0], [-1, 0], [1, 1.2]] as [number, number][]) {
  const h = game.roster[0][0];
  h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(side); h.root.rotation.y = yaw;
  h.lastDt = 1 / 60; h.upright = h.uprightTarget = 0.6;
  game.ballMode = "held";
  (game as unknown as { handler: Player }).handler = h;
  h.holdingBall = true;
  console.log(`\n== 番号側 ${side} 体の向き ${(yaw * 180 / Math.PI).toFixed(0)}° ==`);
  // 相手を遠くへ置く → 腕は振る
  const foe = game.roster[1][0];
  for (const [label, foeAt, spd] of [
    ["相手が遠い・止まっている", 6, 0],
    ["相手が遠い・走っている", 6, 5.5],
    ["相手が近い(1.2m)", 1.2, 2.0],
  ] as [string, number, number][]) {
    foe.pos.set(foeAt, 0, 0);
    h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(side); h.root.rotation.y = yaw;
    h.holdingBall = true; h.upright = h.uprightTarget = 0.6;
    h.curSpd = spd;
    let tilt = 0, n = 0;
    const far: number[] = [], hy: number[] = [], dribY: number[] = [];
    for (let i = 0; i < 240; i++) {
      game.ball.pos.set(h.pos.x + 0.25, 0.4, h.pos.z);
      h.stridePhase += spd > 0 ? 0.3 : 0;
      h.sync();
      (await import("../src/core/poses")).poseHands(game);
      if (i < 120) continue;
      const useLeftBone = (h.dribbleArm === "R") === (h.numberSide > 0);
      tilt += palmTilt(h, useLeftBone ? "LeftHand" : "RightHand"); n++;
      // 空いている手（ドリブルと逆）の位置
      const offBone = useLeftBone ? "RightHand" : "LeftHand";
      {
        const dn = h.vox!.rig.node(useLeftBone ? "LeftHand" : "RightHand" as never)!;
        dn.computeWorldMatrix(true);
        dribY.push((dn.getAbsolutePosition().y - h.pos.y) * 1000);
      }
      const on = h.vox!.rig.node(offBone as never)!;
      on.computeWorldMatrix(true);
      const d = on.getAbsolutePosition().subtract(h.pos);
      // 相手の方向への水平距離（伸ばすほど大きい）
      const to = new Vector3(foe.pos.x - h.pos.x, 0, foe.pos.z - h.pos.z).normalize();
      far.push((d.x * to.x + d.z * to.z) * 1000);
      hy.push(d.y * 1000);
    }
    const lo = Math.min(...far), hi = Math.max(...far);
    const ylo = Math.min(...hy), yhi = Math.max(...hy);
    console.log(`  ${label.padEnd(24)} 手のひら ${(tilt / n).toFixed(1).padStart(5)}°`
      + `  空き手: 相手方向 ${lo.toFixed(0).padStart(5)}〜${hi.toFixed(0).padStart(5)}mm`
      + `  高さ ${ylo.toFixed(0).padStart(4)}〜${yhi.toFixed(0).padStart(4)}mm`
      + `  ｜ ドリブル手の高さ ${Math.min(...dribY).toFixed(0)}〜${Math.max(...dribY).toFixed(0)}mm`);
  }
}

// 生の値: 左右のボクセル手ボーンの高さと、仮想側のドリブル手
console.log("\n生の値（マッピングを介さず左右そのまま）");
for (const [side, foeAt, spd] of [[1, 6, 0], [-1, 6, 0], [1, 1.2, 0], [-1, 1.2, 0]] as [number, number, number][]) {
  const h = game.roster[0][0];
  const foe = game.roster[1][0];
  foe.pos.set(foeAt, 0, 0);
  h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(side); h.root.rotation.y = 0;
  h.holdingBall = true; h.upright = h.uprightTarget = Number(process.env.U ?? 0.6); h.curSpd = spd;
  for (let i = 0; i < 240; i++) {
    game.ball.pos.set(h.pos.x + 0.25, 0.4, h.pos.z);
    h.sync();
    (await import("../src/core/poses")).poseHands(game);
  }
  const y = (b: string): string => {
    const n = h.vox!.rig.node(b as never)!; n.computeWorldMatrix(true);
    const p2 = n.getAbsolutePosition();
    return `${((p2.y - h.pos.y) * 1000).toFixed(0)}mm(x ${((p2.x - h.pos.x) * 1000).toFixed(0)})`;
  };
  console.log(`  番号側${String(side).padStart(2)} 相手${foeAt}m  仮想のドリブル手=${h.dribbleArm}`
    + `  左手 ${y("LeftHand")}  右手 ${y("RightHand")}`);
}

// poseHands を通さず reachDribble を直に呼ぶ（相手なし固定）
console.log("\nreachDribble を直接（guard=null 固定）");
for (const side of [1, -1]) {
  const h = game.roster[0][0];
  h.stand(); h.pos.set(0, 0, 0); h.setNumberSide(side); h.root.rotation.y = 0;
  h.upright = h.uprightTarget = 1.0; h.curSpd = 0; h.holdingBall = false;
  for (let i = 0; i < 240; i++) {
    h.reachDribble(new Vector3(0.25, 0.95, 0), true, 0, null);
    h.sync();
  }
  const y = (b: string): string => {
    const n = h.vox!.rig.node(b as never)!; n.computeWorldMatrix(true);
    const p2 = n.getAbsolutePosition();
    return `${((p2.y - h.pos.y) * 1000).toFixed(0)}mm(x ${((p2.x - h.pos.x) * 1000).toFixed(0)})`;
  };
  const vq = (n: { rotationQuaternion: Quaternion | null }): string =>
    n.rotationQuaternion ? `${(2 * Math.acos(Math.min(1, Math.abs(n.rotationQuaternion.w))) * 180 / Math.PI).toFixed(1)}°` : "なし";
  console.log(`  番号側${String(side).padStart(2)}  左手 ${y("LeftHand")}  右手 ${y("RightHand")}`
    + `  ｜ 仮想 armL ${vq(h.armPivotL)} armR ${vq(h.armPivotR)}`);
}
