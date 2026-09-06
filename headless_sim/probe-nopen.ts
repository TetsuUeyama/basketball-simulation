// 手がボールを貫通していないかを測る。手の各点（中指の付け根・指先など）が
// ボール中心から半径 120mm 以上にあれば貫通していない。
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
const { catchBall } = await import("../src/animation/action/catch");
const { HAND_PTS, BALL_R } = await import("../src/animation/action/palm");
await startRawPreload();
const scene = new Scene(new NullEngine());
const p = new Player(scene, 0, 0, ROSTER[0][0]);
p.pos.set(0, 0, 0); p.resetFacing(); p.stand(); p.clipOverride = "idle"; p.lastDt = 1 / 60;
const K = p.height / 1.804;
const NAMES = ["中指の付け根"];   // 0 番だけ名前を付ける。以降はメッシュの外側の点

const shY = p.pos.y + p.vox!.shoulder.y;
console.log(`ボール半径 ${(BALL_R * 1000).toFixed(0)}mm。手の各点がこれ以上なら貫通していない。`);
console.log("位置        手      最短の点            距離   めり込み");
for (const [dy, dz, note] of [
  [0.34, 0.10, "頭の上"], [0.15, 0.25, "顔の前"], [-0.15, 0.30, "胸の高さ"], [-0.35, 0.20, "腰の高さ"],
] as [number, number, string][]) {
  p.stand();
  const b = new Vector3(0, shY + dy, -dz * p.numberSide);
  for (let i = 0; i < 300; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
  for (const bn of ["LeftHand", "RightHand"] as const) {
    const n = p.vox!.rig.node(bn as never)!;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    let best = 0, bestD = Infinity;
    for (let i = 0; i < HAND_PTS[bn].length; i++) {
      const w = Vector3.TransformCoordinates(HAND_PTS[bn][i].scale(K), m);
      const d = Vector3.Distance(w, b);
      if (d < bestD) { bestD = d; best = i; }
    }
    const pen = BALL_R - bestD;
    console.log(`  ${note.padEnd(8)} ${bn === "LeftHand" ? "左" : "右"}  ${(NAMES[best] ?? "手の外側 #" + best).padEnd(14)}`
      + ` ${(bestD * 1000).toFixed(0).padStart(4)}mm  `
      + (pen > 0.002 ? `★${(pen * 1000).toFixed(0)}mm 貫通` : "なし"));
  }
}


// 本当のメッシュで測る（指のボーン6点ではなく、手のボクセルの頂点すべて）
console.log("");
console.log("手のメッシュの頂点で測った貫通量");
{
  const body = p.vox!.meshes.find((m) => m.name.startsWith("body_"))!;
  const pos = body.getVerticesData("position")!;
  const bi = body.getVerticesData("matricesIndices")!;
  const bw = body.getVerticesData("matricesWeights")!;
  const skel = p.vox!.skel;
  const idx = new Map(skel.bones.map((b, i) => [b.name, i]));
  // 手のボーンが主で動く頂点を集める（静止姿勢の座標）
  const hands: Record<string, number[]> = { LeftHand: [], RightHand: [] };
  for (let i = 0; i < pos.length / 3; i++) {
    let best = -1, bestW = 0;
    for (let k = 0; k < 4; k++) if (bw[i * 4 + k] > bestW) { bestW = bw[i * 4 + k]; best = bi[i * 4 + k]; }
    if (bestW < 0.8) continue;
    for (const bn of ["LeftHand", "RightHand"]) if (best === idx.get(bn)) hands[bn].push(i);
  }
  console.log(`  手の頂点 左 ${hands.LeftHand.length} / 右 ${hands.RightHand.length}`);
  for (const [dy, dz, note] of [
    [0.34, 0.10, "頭の上"], [0.15, 0.25, "顔の前"], [-0.15, 0.30, "胸の高さ"], [-0.35, 0.20, "腰の高さ"],
  ] as [number, number, string][]) {
    p.stand();
    const b = new Vector3(0, shY + dy, -dz * p.numberSide);
    for (let i = 0; i < 300; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
    const out: string[] = [];
    for (const bn of ["LeftHand", "RightHand"] as const) {
      const n = p.vox!.rig.node(bn as never)!;
      n.computeWorldMatrix(true);
      const m = n.getWorldMatrix();
      let deep = 0, cnt = 0;
      for (const vi of hands[bn]) {
        const w = Vector3.TransformCoordinates(
          new Vector3(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]), m);
        const d = BALL_R - Vector3.Distance(w, b);
        if (d > 0) { cnt++; if (d > deep) deep = d; }
      }
      out.push(`${bn === "LeftHand" ? "左" : "右"} ${cnt} 頂点 最大 ${(deep * 1000).toFixed(0)}mm`);
    }
    console.log(`  ${note.padEnd(8)} ${out.join("  /  ")}`);
  }
}


// 体すべてのメッシュで、いろいろな位置（頭の上・後ろ・遠近）を調べる
console.log("");
console.log("体すべてのメッシュでの貫通（高さ/横/奥行き）");
{
  type Part = { name: string; pos: Float32Array | number[]; bi: Float32Array | number[];
    bw: Float32Array | number[] };
  const parts: Part[] = [];
  for (const m of p.vox!.meshes) {
    const pos2 = m.getVerticesData("position"), bi2 = m.getVerticesData("matricesIndices"),
      bw2 = m.getVerticesData("matricesWeights");
    if (pos2 && bi2 && bw2) parts.push({ name: m.name.split("_")[0], pos: pos2, bi: bi2, bw: bw2 });
  }
  const skel = p.vox!.skel;
  const boneName = skel.bones.map((b) => b.name);
  const nodes = boneName.map((n) => p.vox!.rig.node(n as never));
  const cases: [number, number, number, string][] = [
    [0.34, 0, 0.10, "頭の上・正面"],
    [0.34, 0, -0.10, "頭の上・少し後ろ"],
    [0.34, 0, -0.30, "頭の後ろ"],
    [0.20, 0.35, 0.10, "頭の横"],
    [0.15, 0, 0.25, "顔の前"],
    [-0.15, 0, 0.30, "胸の高さ"],
    [-0.15, 0, 0.12, "胸の高さ・体に近い"],
    [-0.35, 0, 0.20, "腰の高さ"],
  ];
  // バインド逆行列（静止姿勢のボーン → 素体空間 の逆）
  const _sk = new (await import("@babylonjs/core")).Matrix();
  const binv = skel.bones.map((bo) => bo.getInvertedAbsoluteTransform());
  for (const [dy, dx, dz, note] of cases) {
    p.stand();
    const th = p.root.rotation.y;
    const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
    const b = new Vector3(p.pos.x + fx * dz + fz * dx, shY + dy, p.pos.z + fz * dz - fx * dx);
    for (let i = 0; i < 300; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
    for (const n of nodes) n?.computeWorldMatrix(true);
    let deep = 0, cnt = 0, who = "";
    for (const part of parts) {
      for (let i = 0; i < part.pos.length / 3; i++) {
        let best = -1, bestW = 0;
        for (let k = 0; k < 4; k++) if (part.bw[i * 4 + k] > bestW) { bestW = part.bw[i * 4 + k]; best = part.bi[i * 4 + k]; }
        const nd = nodes[best];
        if (!nd || bestW < 0.8) continue;
        // ⚠️ メッシュの頂点は**素体の空間**にある。ボーンのワールド行列を直に掛けては
        //    いけない（バインド逆行列を挟む）。掛けると、離れた部位が別の場所へ飛ぶ。
        nd.getWorldMatrix().multiplyToRef(binv[best], _sk);
        const w = Vector3.TransformCoordinates(
          new Vector3(part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]), _sk);
        const d = BALL_R - Vector3.Distance(w, b);
        if (d > 0.002) { cnt++; if (d > deep) { deep = d; who = `${part.name}/${boneName[best]}`; } }
      }
    }
    console.log(`  ${note.padEnd(18)} ${cnt === 0 ? "貫通なし" : `★${cnt} 頂点 最大 ${(deep * 1000).toFixed(0)}mm (${who})`}`);
  }
}

// 手のメッシュだけを、広い範囲（高さ×横×奥行き）で調べる
console.log("");
console.log("手のメッシュの貫通（高さ×横×奥行きを総当たり）");
{
  const body = p.vox!.meshes.find((m) => m.name.startsWith("body_"))!;
  const pos = body.getVerticesData("position")!;
  const bi = body.getVerticesData("matricesIndices")!;
  const bw = body.getVerticesData("matricesWeights")!;
  const skel = p.vox!.skel;
  const idx = new Map(skel.bones.map((b, i) => [b.name, i]));
  const binv = skel.bones.map((bo) => bo.getInvertedAbsoluteTransform());
  const { Matrix } = await import("@babylonjs/core");
  const sk = new Matrix();
  const hands: Record<string, number[]> = { LeftHand: [], RightHand: [] };
  for (let i = 0; i < pos.length / 3; i++) {
    let best = -1, bestW = 0;
    for (let k = 0; k < 4; k++) if (bw[i * 4 + k] > bestW) { bestW = bw[i * 4 + k]; best = bi[i * 4 + k]; }
    if (bestW < 0.8) continue;
    for (const bn of ["LeftHand", "RightHand"]) if (best === idx.get(bn)) hands[bn].push(i);
  }
  let worst = 0, worstAt = "";
  let bad = 0, total = 0;
  for (const dy of [0.45, 0.30, 0.15, 0, -0.20, -0.40]) {
    const row: string[] = [];
    for (const dz of [-0.25, 0, 0.20, 0.40]) {
      let deepRow = 0;
      for (const dx of [-0.45, 0, 0.45]) {
        p.stand();
        const th = p.root.rotation.y;
        const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
        const b = new Vector3(p.pos.x + fx * dz + fz * dx, shY + dy, p.pos.z + fz * dz - fx * dx);
        for (let i = 0; i < 260; i++) { catchBall(p, b); p.lastDt = 1 / 60; p.sync(); }
        total++;
        let deep = 0;
        for (const bn of ["LeftHand", "RightHand"] as const) {
          const nd = p.vox!.rig.node(bn as never)!;
          nd.computeWorldMatrix(true);
          nd.getWorldMatrix().multiplyToRef(binv[idx.get(bn)!], sk);
          for (const vi of hands[bn]) {
            const w = Vector3.TransformCoordinates(
              new Vector3(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]), sk);
            const d = BALL_R - Vector3.Distance(w, b);
            if (d > deep) deep = d;
          }
        }
        if (deep > 0.002) bad++;
        if (deep > deepRow) deepRow = deep;
        if (deep > worst) { worst = deep; worstAt = `高さ${dy.toFixed(2)} 横${dx.toFixed(2)} 奥${dz.toFixed(2)}`; }
      }
      row.push(`${(deepRow * 1000).toFixed(0)}mm`.padStart(6));
    }
    console.log(`  肩から ${dy >= 0 ? "+" : ""}${dy.toFixed(2)}m  奥行き -0.25/0/+0.20/+0.40 → ${row.join("")}`);
  }
  console.log(`  ${total} か所中 ${bad} か所で貫通。最大 ${(worst * 1000).toFixed(0)}mm（${worstAt}）`);
}
