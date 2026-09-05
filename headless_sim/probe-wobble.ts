// 関節ごとのばらつきを見る。
//  ① 同じ瞬間に関節ごとの値が違うか（帯の中に収まっているか）
//  ② 時間とともにゆっくり漂うか（震えていないか）
//  ③ 選手ごとに違うか
//  ④ 顔と足裏の水平が崩れていないか
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
const { stanceS, G } = await import("../src/animation/basic/stance");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();

const names = Object.keys(G) as (keyof typeof G)[];
const players = [game.roster[0][0], game.roster[0][1], game.roster[1][0]];
for (const p of players) { p.stand(); p.pos.set(0, 0, 0); p.lastDt = 1 / 60; p.setNumberSide(1); }

/** 全員を n 秒ぶん進める。 */
function advance(sec: number): void {
  const steps = Math.round(sec * 60);
  for (let i = 0; i < steps; i++) for (const p of players) { p.upright = p.uprightTarget; p.sync(); }
}
for (const p of players) { p.upright = p.uprightTarget = 1.0; }
advance(2);

console.log("① 直立度 1.00 のとき、脚・胴と腕それぞれの実効値の帯（1.00 が直立）");
const LEG = ["thighL", "thighR", "shinL", "shinR", "stanceL", "stanceR", "outL", "outR", "lean"] as const;
const ARM = ["shoulderL", "shoulderR", "armL", "armR", "foreL", "foreR", "splay"] as const;
{
  // 長めに回して、それぞれの区分がどこまで振れるかを見る
  const lo = new Map<string, number>(), hi = new Map<string, number>();
  for (const n of names) { lo.set(n, 9); hi.set(n, -9); }
  for (let i = 0; i < 40; i++) {
    advance(0.4);
    for (const n of names) {
      const v = 1 - stanceS(players[0], G[n]);
      lo.set(n, Math.min(lo.get(n)!, v)); hi.set(n, Math.max(hi.get(n)!, v));
    }
  }
  const band = (ks: readonly string[]): string => {
    const l = Math.min(...ks.map((k) => lo.get(k)!)), h = Math.max(...ks.map((k) => hi.get(k)!));
    return `${l.toFixed(3)}〜${h.toFixed(3)}（幅 ${((h - l) * 100).toFixed(1)}%）`;
  };
  console.log(`  脚・胴 ${band(LEG)}`);
  console.log(`  腕     ${band(ARM)}`);
}
for (const p of players) {
  const v = names.map((n) => (1 - stanceS(p, G[n])).toFixed(3));
  console.log(`  ${p.name.slice(0, 8).padEnd(9)} ${v.slice(0, 8).join(" ")}`);
}

console.log("\n② 時間で漂うか（左腿の実効値を 0.5 秒ごと）");
{
  const p = players[0];
  const seq: string[] = [];
  for (let i = 0; i < 10; i++) { advance(0.5); seq.push((1 - stanceS(p, G.thighL)).toFixed(3)); }
  console.log("  " + seq.join(" "));
  let jump = 0;
  for (let i = 1; i < seq.length; i++) jump = Math.max(jump, Math.abs(Number(seq[i]) - Number(seq[i - 1])));
  console.log(`  0.5秒あたりの最大変化 ${jump.toFixed(3)}（小さいほどゆっくり）`);
}

console.log("\n③ 選手ごとに違うか（同じ瞬間の左腿）");
console.log("  " + players.map((p) => `${p.name.slice(0, 6)}=${(1 - stanceS(p, G.thighL)).toFixed(3)}`).join("  "));

console.log("\n④ 深い構えでも顔と足裏は水平か");
const UP = new Vector3(0, 1, 0);
for (const u of [1.0, 0.5, 0.0]) {
  const p = players[0];
  p.upright = p.uprightTarget = u;
  advance(1.5);
  p.root.computeWorldMatrix(true);
  const dirOf = (bone: string, local: Vector3): Vector3 => {
    const n = p.vox!.rig.node(bone as never)!;
    n.computeWorldMatrix(true);
    const m = n.getWorldMatrix();
    const o = Vector3.TransformCoordinates(Vector3.Zero(), m);
    return Vector3.TransformCoordinates(local, m).subtract(o).normalize();
  };
  const face = dirOf("Head", new Vector3(0, 0, 1));
  const fl = dirOf("LeftFoot", UP), fr = dirOf("RightFoot", UP);
  const deg = (v: Vector3): number => Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(v, UP)))) * 180 / Math.PI;
  console.log(`  直立度 ${u.toFixed(2)}  顔の上下 ${(Math.asin(face.y) * 180 / Math.PI).toFixed(1)}°`
    + `  足裏 左 ${deg(fl).toFixed(1)}° 右 ${deg(fr).toFixed(1)}°`);
}
