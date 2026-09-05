// 膝が外を向いているかを測る。膝が「どちらを向いているか」は、股関節と足首を結んだ
// 線から膝がどちらへ張り出しているかで決まる。
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
const UP = new Vector3(0, 1, 0);

function run(t: number, side: number, yaw: number): void {
  const p = game.roster[t][0];
  // 体の前・右（体の枠）
  const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(-side);
  const r = new Vector3(f.z, 0, -f.x);        // 前を左へ90°回すと右
  console.log(`\n== チーム${t} 番号側${side} 向き${(yaw * 180 / Math.PI).toFixed(0)}° ==`);
  console.log("直立度  左膝の張り出し(外+)  右膝の張り出し(外+)  足裏の傾き");
  for (const u of [1.0, 0.5, 0.0]) {
    p.stand(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60; p.setNumberSide(side); p.root.rotation.y = yaw;
    p.upright = p.uprightTarget = u;
    for (let i = 0; i < 3; i++) p.sync();
    p.root.computeWorldMatrix(true);
    const at = (b: string): Vector3 => {
      const n = p.vox!.rig.node(b as never)!; n.computeWorldMatrix(true);
      return n.getAbsolutePosition();
    };
    const out: number[] = [];
    for (const [hip, knee, ankle, sgn] of [
      ["LeftUpperLeg", "LeftLowerLeg", "LeftFoot", -1],
      ["RightUpperLeg", "RightLowerLeg", "RightFoot", 1],
    ] as [string, string, string, number][]) {
      const h = at(hip), k = at(knee), a = at(ankle);
      const mid = h.add(a).scale(0.5);
      const d = k.subtract(mid);
      out.push((d.x * r.x + d.z * r.z) * sgn * 1000);   // 体の外向き成分
    }
    const fn = p.vox!.rig.node("LeftFoot" as never)!;
    fn.computeWorldMatrix(true);
    const m = fn.getWorldMatrix();
    const o = Vector3.TransformCoordinates(Vector3.Zero(), m);
    const up = Vector3.TransformCoordinates(UP, m).subtract(o).normalize();
    const tilt = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(up, UP)))) * 180 / Math.PI;
    console.log(`  ${u.toFixed(2)}  ${out[0].toFixed(0).padStart(15)}mm  ${out[1].toFixed(0).padStart(15)}mm`
      + `  ${tilt.toFixed(1).padStart(8)}°`);
  }
}
run(0, 1, 0);
run(1, -1, 1.2);
