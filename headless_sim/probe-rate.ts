// 全ボーンの「1フレームあたりの回転量」の分布を見る。
// どこまでが普通の動き（走り・シュート）で、どこからが一瞬で飛んでいるのかを分ける。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Quaternion } from "@babylonjs/core";
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
const { syncAll } = await import("../src/core/visuals");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
const DT = 1 / 60;
const prev = new Map<string, Quaternion>();
const all: number[] = [];
const perBone = new Map<string, number[]>();
for (let i = 0; i < 60 * 90; i++) {
  game.update(DT);
  syncAll(game);
  if (i < 180) continue;
  for (const p of game.players) {
    if (!p.vox) continue;
    for (const b of p.vox.rig.bones) {
      const n = p.vox.rig.node(b);
      const q = n?.rotationQuaternion;
      if (!q) continue;
      const key = `${p.team}_${p.idx}_${b}`;
      const o = prev.get(key);
      if (o) {
        const d = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(o, q)))) * 180 / Math.PI;
        all.push(d);
        let arr = perBone.get(b as string);
        if (!arr) { arr = []; perBone.set(b as string, arr); }
        arr.push(d);
        o.copyFrom(q);
      } else prev.set(key, q.clone());
    }
  }
}
all.sort((a, b) => a - b);
const pc = (a: number[], q: number): number => a[Math.min(a.length - 1, Math.floor(a.length * q))];
console.log(`全ボーン・全選手の 1 フレーム回転量（${all.length.toLocaleString()} 標本、90 秒ぶん）`);
for (const q of [0.5, 0.9, 0.99, 0.999, 0.9999, 1]) {
  console.log(`  ${(q * 100).toFixed(2).padStart(7)}%  ${pc(all, q === 1 ? 0.999999 : q).toFixed(1)}°`);
}
console.log("\n主なボーンの 99.9% と最大");
for (const b of ["LeftUpperArm", "LeftLowerArm", "LeftHand", "LeftUpperLeg", "LeftLowerLeg", "Spine", "Head"]) {
  const a = perBone.get(b);
  if (!a) continue;
  a.sort((x, y) => x - y);
  console.log(`  ${b.padEnd(14)} 99.9% ${pc(a, 0.999).toFixed(1).padStart(6)}°   最大 ${a[a.length - 1].toFixed(1).padStart(6)}°`);
}
