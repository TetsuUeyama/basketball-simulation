// 背番号の板が、ゲームと同じ経路で組んだときに背中の高さに来ているかを測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode, Vector3, type Mesh } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
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
const engine = new NullEngine(); const scene = new Scene(engine);
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();

function box(m: Mesh) {
  m.computeWorldMatrix(true); m.refreshBoundingInfo();
  const b = m.getBoundingInfo().boundingBox;
  return { lo: b.minimumWorld, hi: b.maximumWorld };
}
const f = (v: { x: number; y: number; z: number }) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;

for (const [t, i] of [[0, 0], [0, 5], [1, 2]] as [number, number][]) {
  const p = game.roster[t][i];
  p.setNumberSide(1);
  p.stand(); p.lastDt = 1 / 60; p.sync();
  const jersey = p.vox!.meshes.find((m) => m.name.startsWith("jersey_")) as Mesh;
  const panel = scene.meshes.find((m) => m.name === `rawnumshell_${t}_${i}`) as Mesh;
  const bj = box(jersey), bp = box(panel);
  console.log(`選手 ${t}-${i} (${p.name})  足元 y=${p.root.position.y.toFixed(2)}`);
  console.log(`  ジャージ  ${f(bj.lo)} 〜 ${f(bj.hi)}`);
  console.log(`  番号の板  ${f(bp.lo)} 〜 ${f(bp.hi)}`
    + `   ${bp.hi.y < bj.lo.y || bp.lo.y > bj.hi.y ? "★ジャージの外" : "帯はジャージの中"}`);
}

// 板が「背中側」の「服のすぐ外」に居るかを、静止のまま体格ごとに確かめる。
// ⚠️ sync() を掛けたあとの選手と比べてはいけない。板は Spine ノードに直付け、服は
//    スキニングなので、getVerticesData で読める服の頂点は静止のまま。姿勢を付けた
//    板と静止の服を比べると、胴の前傾のぶんだけ「めり込み」に見える。
console.log("");
console.log("静止での位置（背中は -Z 側）");
{
  const { buildRawVoxelBody } = await import("../src/objects/player/player-raw");
  const KIT = { top: { r: .1, g: .25, b: .6 }, bottom: { r: .1, g: .25, b: .6 }, shoes: { r: 1, g: 1, b: 1 } };
  for (const [h, kg] of [[1.70, 62], [1.80, 75], [1.80, 95], [1.95, 88], [2.05, 105]] as [number, number][]) {
    const par = new TransformNode("q", scene);
    const vb = buildRawVoxelBody(scene, par, {
      name: `q${h}_${kg}`, balance: 50, height: h, weight: kg,
      skin: { r: .8, g: .6, b: .5 }, hair: { r: .1, g: .1, b: .1 },
      hairNo: 0, kit: KIT, jerseyText: "8",
    })!;
    vb.root.computeWorldMatrix(true);
    const inv = vb.root.getWorldMatrix().clone().invert();
    const panel = scene.meshes.find((m) => m.name === `rawnumshell_q${h}_${kg}`) as Mesh;
    panel.computeWorldMatrix(true);
    const toLocal = (m: Mesh) => {
      const d = m.getVerticesData("position")!; const w = m.getWorldMatrix();
      const out: Vector3[] = [];
      for (let k = 0; k < d.length; k += 3) {
        out.push(Vector3.TransformCoordinates(
          Vector3.TransformCoordinates(new Vector3(d[k], d[k + 1], d[k + 2]), w), inv));
      }
      return out;
    };
    const pts = toLocal(panel);
    const yMin = Math.min(...pts.map((v) => v.y)), yMax = Math.max(...pts.map((v) => v.y));
    const zMin = Math.min(...pts.map((v) => v.z));
    const jersey = vb.meshes.find((m) => m.name.startsWith("jersey_")) as Mesh;
    jersey.computeWorldMatrix(true);
    let jz = Infinity;
    for (const v of toLocal(jersey)) {
      if (v.y < yMin || v.y > yMax || Math.abs(v.x) > 0.08) continue;
      if (v.z < jz) jz = v.z;
    }
    console.log(`  身長${(h * 100).toFixed(0)}cm ${kg}kg  板 Y ${yMin.toFixed(2)}〜${yMax.toFixed(2)}`
      + ` 最奥Z ${zMin.toFixed(3)}  服の背面 ${jz.toFixed(3)}`
      + `  → ${zMin < 0 ? "背中側" : "★正面側"} / ${zMin <= jz ? `服の ${((jz - zMin) * 1000).toFixed(1)}mm 外 OK` : `★${((zMin - jz) * 1000).toFixed(1)}mm めり込み`}`);
    vb.dispose();
  }
}
