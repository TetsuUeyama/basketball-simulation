// 手のひらの当たる点がボールの表面に来ているかを測る。
//   ・当たる点とボール中心の距離 → ボール半径 120mm ならぴったり
//   ・手のひらの法線とボール方向のなす角 → 0° なら手のひらがボールを向いている
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
import { Player } from "../src/objects/player/player";
Player.HEADLESS = false;
import { ROSTER } from "../src/roster";
import "../src/objects/player/player-state";
import "../src/objects/player/player-query";
import "../src/objects/player/player-roster";
import "../src/objects/player/player-visual";
import "../src/animation/basic/arms";
import "../src/animation/basic/torso";
import "../src/animation/action/dribble";
import "../src/animation/action/guard";
import "../src/animation/action/hold";
import "../src/animation/action/locomotion";
import "../src/animation/action/reach";
import "../src/animation/action/reach-ik";
import "../src/animation/action/screen";
import "../src/animation/action/shoot";
import "../src/animation/action/sit";
import "../src/animation/reaction/bench-idle";
import "../src/animation/reaction/defwin";
import "../src/animation/reaction/dejected";
import "../src/animation/reaction/foul-react";
import "../src/move/basic/jump";
import "../src/move/basic/run";
import "../src/move/basic/turn";
const { startRawPreload } = await import("../src/objects/player/player-raw");
const { catchBall, catchLabel } = await import("../src/animation/action/catch");
const { PALM_N, PALM_PT, BALL_R } = await import("../src/animation/action/palm");
await startRawPreload();
const scene = new Scene(new NullEngine());
const p = new Player(scene, 0, 0, ROSTER[0][0]);
p.pos.set(0, 0, 0); p.resetFacing(); p.stand(); p.clipOverride = "idle"; p.lastDt = 1 / 60;
const K = p.height / 1.804;      // 身長ぶんの倍率

/** 手のひらの当たる点（ワールド）と法線。 */
function palm(bone: "LeftHand" | "RightHand"): { pt: Vector3; n: Vector3 } {
  const n = p.vox!.rig.node(bone as never)!;
  n.computeWorldMatrix(true);
  const m = n.getWorldMatrix();
  const o = Vector3.TransformCoordinates(Vector3.Zero(), m);
  const pt = Vector3.TransformCoordinates(PALM_PT[bone].scale(K), m);
  const nr = Vector3.TransformCoordinates(PALM_N[bone], m).subtract(o).normalize();
  return { pt, n: nr };
}
console.log(`身長 ${(p.height * 100).toFixed(0)}cm ｜ ボール半径 ${(BALL_R * 1000).toFixed(0)}mm`);
console.log("ボール(高さ,横)      形              当たる点→ボール中心   ズレ    手のひらの向き");
for (const [by, bx, note] of [
  [2.05, 0.00, "頭の上・正面"],
  [1.80, 0.00, "やや上・正面"],
  [1.35, 0.00, "胸の高さ・正面"],
  [1.35, 0.55, "胸の高さ・横"],
  [0.90, 0.00, "腰の高さ・正面"],
  [0.60, 0.45, "低い・横"],
] as [number, number, string][]) {
  p.stand();
  const b = new Vector3(bx, by, -0.35 * p.numberSide);
  let sh = catchBall(p, b);
  for (let i = 0; i < 200; i++) { sh = catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  const bones: ("LeftHand" | "RightHand")[] = sh.two ? ["LeftHand", "RightHand"]
    : [sh.right === (p.numberSide > 0) ? "LeftHand" : "RightHand"];
  const parts = bones.map((bn) => {
    const q = palm(bn);
    const d = Vector3.Distance(q.pt, b);
    const toBall = b.subtract(q.pt).normalize();
    const ang = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(q.n, toBall)))) * 180 / Math.PI;
    return `${(d * 1000).toFixed(0)}mm(${((d - BALL_R) * 1000 >= 0 ? "+" : "")}${((d - BALL_R) * 1000).toFixed(0)}) ${ang.toFixed(0)}°`;
  });
  console.log(`  ${note.padEnd(16)} ${catchLabel(p, sh).padEnd(16)} ${parts.join("  /  ")}`);
}

// GRIP_PULL の掃引: 当たる点とボール中心の距離が 120mm に一番近い値を探す
console.log("\nGRIP_PULL の掃引（当たる点→ボール中心、狙い 120mm）");
for (const pull of [0.00, 0.05, 0.10, 0.15, 0.19, 0.25, 0.30]) {
  (globalThis as unknown as { __gripPull: number }).__gripPull = pull;
  const rows: string[] = [];
  for (const [by, bx] of [[2.05, 0], [1.35, 0], [1.35, 0.55], [0.9, 0]] as [number, number][]) {
    p.stand();
    const b = new Vector3(bx, by, -0.35 * p.numberSide);
    let sh = catchBall(p, b);
    for (let i = 0; i < 150; i++) { sh = catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
    const bn: "LeftHand" | "RightHand" = sh.two || sh.right === (p.numberSide > 0) ? "LeftHand" : "RightHand";
    rows.push(((Vector3.Distance(palm(bn).pt, b)) * 1000).toFixed(0));
  }
  console.log(`  pull ${pull.toFixed(2)}m → ${rows.join(" / ")} mm`);
}

// IK が狙った所に手首を置けているか
console.log("\n手首は狙いに届いているか（ボール 胸の高さ・正面）");
(globalThis as unknown as { __gripPull: number }).__gripPull = 0.19;
{
  const { gripTarget } = await import("../src/animation/action/palm");
  p.stand();
  const b = new Vector3(0, 1.35, -0.35 * p.numberSide);
  for (let i = 0; i < 200; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  const t = gripTarget(p, b);
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never)!;
    n.computeWorldMatrix(true);
    const w = n.getAbsolutePosition();
    console.log(`  ${bn} 手首 ${w.x.toFixed(3)},${w.y.toFixed(3)},${w.z.toFixed(3)}`
      + `  狙い ${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)}`
      + `  ズレ ${(Vector3.Distance(w, t) * 1000).toFixed(0)}mm`);
  }
  // 仮想側の手首ノードはどこか
  for (const [nm, nd] of [["wristL", p.wristL], ["wristR", p.wristR]] as const) {
    nd.computeWorldMatrix(true);
    const w = nd.getAbsolutePosition();
    console.log(`  仮想 ${nm} ${w.x.toFixed(3)},${w.y.toFixed(3)},${w.z.toFixed(3)}`
      + `  ボールまで ${(Vector3.Distance(w, b) * 1000).toFixed(0)}mm`);
  }
}

// 仮想の骨組みとボクセルのボーンで、腕の長さが合っているか
console.log("\n腕の長さ（仮想 vs ボクセル）");
{
  const v = p.vox!;
  const at = (b: string): Vector3 => {
    const n = v.rig.node(b as never)!; n.computeWorldMatrix(true);
    return n.getAbsolutePosition();
  };
  p.stand(); p.lastDt = 1 / 60; p.sync();
  const sh = at("LeftUpperArm"), el = at("LeftLowerArm"), hd = at("LeftHand");
  console.log(`  ボクセル 上腕 ${(Vector3.Distance(sh, el) * 1000).toFixed(0)}mm`
    + `  前腕 ${(Vector3.Distance(el, hd) * 1000).toFixed(0)}mm`);
  console.log(`  仮想     上腕 ${(p.upperArmLen * 1000).toFixed(0)}mm`
    + `  前腕 ${(p.foreArmLen * 1000).toFixed(0)}mm`);
  console.log(`  手首から手のひらの当たる点まで ${(PALM_PT.LeftHand.length() * K * 1000).toFixed(0)}mm`);
  console.log(`  → 手のひらまでの実効長は 前腕 ${((Vector3.Distance(el, hd) + PALM_PT.LeftHand.length() * K) * 1000).toFixed(0)}mm`
    + ` のはず（仮想は ${(p.foreArmLen * 1000).toFixed(0)}mm）`);
}

// 仮想の腕とボクセルの腕で、向きが一致しているか
console.log("\n腕の向き（仮想 vs ボクセル、ボール 胸の高さ・正面）");
{
  const b2 = new Vector3(0, 1.35, -0.35 * p.numberSide);
  p.stand();
  for (let i = 0; i < 200; i++) { catchBall(p, b2); p.lastDt = 1 / 60; p.sync(); }
  const at = (b: string): Vector3 => {
    const n = p.vox!.rig.node(b as never)!; n.computeWorldMatrix(true);
    return n.getAbsolutePosition();
  };
  const va = (n: { computeWorldMatrix(f: boolean): unknown; getAbsolutePosition(): Vector3 }): Vector3 => {
    n.computeWorldMatrix(true); return n.getAbsolutePosition();
  };
  const back = p.numberSide > 0;
  // 仮想 L は back のときボクセル Right
  for (const [vName, vPiv, vElb, vWr, bone] of [
    ["armL", p.armPivotL, p.elbowL, p.wristL, back ? "Right" : "Left"],
    ["armR", p.armPivotR, p.elbowR, p.wristR, back ? "Left" : "Right"],
  ] as [string, never, never, never, string][]) {
    const vs = va(vPiv), ve = va(vElb), vw = va(vWr);
    const bs = at(bone + "UpperArm"), be = at(bone + "LowerArm"), bh = at(bone + "Hand");
    const dUpV = ve.subtract(vs).normalize(), dUpB = be.subtract(bs).normalize();
    const dFoV = vw.subtract(ve).normalize(), dFoB = bh.subtract(be).normalize();
    const ang = (a: Vector3, c: Vector3): string =>
      (Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(a, c)))) * 180 / Math.PI).toFixed(1) + "°";
    console.log(`  ${vName} → ${bone}  上腕の向きの差 ${ang(dUpV, dUpB)}  前腕の向きの差 ${ang(dFoV, dFoB)}`);
    console.log(`    仮想 肩 ${vs.x.toFixed(3)},${vs.y.toFixed(3)},${vs.z.toFixed(3)}`
      + `  ボクセル 肩 ${bs.x.toFixed(3)},${bs.y.toFixed(3)},${bs.z.toFixed(3)}`
      + `  ズレ ${(Vector3.Distance(vs, bs) * 1000).toFixed(0)}mm`);
    console.log(`    仮想 肘 ${ve.x.toFixed(3)},${ve.y.toFixed(3)},${ve.z.toFixed(3)}`
      + `  ボクセル 肘 ${be.x.toFixed(3)},${be.y.toFixed(3)},${be.z.toFixed(3)}`
      + `  ズレ ${(Vector3.Distance(ve, be) * 1000).toFixed(0)}mm`);
  }
}

// 腕が届く範囲での確認（肩から腕の長さ以内に置く）
console.log("\n腕が届く位置での確認（当たる点→ボール中心。狙いは 120mm）");
{
  const armLen = p.upperArmLen + p.foreArmLen;
  const shY = p.pos.y + p.vox!.shoulder.y;
  console.log(`  肩の高さ ${(shY * 1000).toFixed(0)}mm / 腕の長さ ${(armLen * 1000).toFixed(0)}mm`);
  for (const [dy, dz, note] of [
    [0.34, 0.10, "頭の上（リバウンド）"],
    [0.15, 0.25, "顔の前"],
    [-0.15, 0.30, "胸の高さ"],
    [-0.35, 0.20, "腰の高さ"],
  ] as [number, number, string][]) {
    p.stand();
    const b4 = new Vector3(0, shY + dy, -dz * p.numberSide);
    let sh = catchBall(p, b4);
    for (let i = 0; i < 250; i++) { sh = catchBall(p, b4); p.lastDt = 1 / 60; p.sync(); }
    const parts = (sh.two ? ["LeftHand", "RightHand"] : [sh.right === (p.numberSide > 0) ? "LeftHand" : "RightHand"])
      .map((bn) => {
        const q = palm(bn as "LeftHand");
        const d = Vector3.Distance(q.pt, b4);
        const ang = Math.acos(Math.min(1, Math.max(-1,
          Vector3.Dot(q.n, b4.subtract(q.pt).normalize())))) * 180 / Math.PI;
        return `${(d * 1000).toFixed(0)}mm ${ang.toFixed(0)}°`;
      });
    console.log(`  ${note.padEnd(18)} ${catchLabel(p, sh).padEnd(16)} ${parts.join(" / ")}`);
  }
}

// ボールは手のどこにあるか（肘・手首・当たる点・指先との距離）
console.log("\nボールは腕のどこにあるか");
{
  const shY = p.pos.y + p.vox!.shoulder.y;
  for (const [dy, dz, note] of [
    [0.34, 0.10, "頭の上"], [-0.15, 0.30, "胸の高さ"],
  ] as [number, number, string][]) {
    p.stand();
    const b5 = new Vector3(0, shY + dy, -dz * p.numberSide);
    for (let i = 0; i < 250; i++) { catchBall(p, b5); p.lastDt = 1 / 60; p.sync(); }
    for (const bn of ["LeftHand", "RightHand"] as const) {
      const at = (x: string): Vector3 => {
        const n = p.vox!.rig.node(x as never)!; n.computeWorldMatrix(true);
        return n.getAbsolutePosition();
      };
      const side = bn === "LeftHand" ? "Left" : "Right";
      const el = at(side + "LowerArm"), wr = at(bn);
      const q = palm(bn);
      // 指先＝手首から長軸方向へ 232mm（静止姿勢の実測）
      const hm = p.vox!.rig.node(bn as never)!.getWorldMatrix();
      const tip = Vector3.TransformCoordinates(
        new Vector3(-0.837, -0.546, -0.018).scale(0.232 * K * (bn === "RightHand" ? -1 : 1)), hm);
      console.log(`  ${note.padEnd(8)} ${bn.padEnd(10)}`
        + ` 肘まで ${(Vector3.Distance(el, b5) * 1000).toFixed(0)}mm`
        + ` 手首まで ${(Vector3.Distance(wr, b5) * 1000).toFixed(0)}mm`
        + ` 当たる点まで ${(Vector3.Distance(q.pt, b5) * 1000).toFixed(0)}mm`
        + ` 指先まで ${(Vector3.Distance(tip, b5) * 1000).toFixed(0)}mm`);
    }
  }
}
