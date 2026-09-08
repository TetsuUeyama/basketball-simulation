// ジャンプボールで伸ばす腕は、利き腕になっているか。
// コートの向き(numberSide)で伸ばす腕が入れ替わっていないかも見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene } from "@babylonjs/core";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
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
import { twoHandGrab } from "../src/core/poses";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
type BN = Parameters<NonNullable<Player["vox"]>["rig"]["node"]>[0];

// 集計: 利き腕を伸ばしたか / numberSide で入れ替わっていないか
const tally: Record<string, number> = {};
let n = 0, two = 0, one = 0;
const sideX: number[] = [];
for (let gi = 0; gi < 12; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  // ジャンプボールが終わるまで回す
  let seen = false;
  for (let i = 0; i < 60 * 30; i++) {
    game.update(DT);
    if (game.ballMode !== "tipoff") { if (seen) break; continue; }
    seen = true;
    for (const c of [game.teamPlayers(0)[4], game.teamPlayers(1)[4]]) {
      if (!c.airborne || !c.vox) continue;
      const l = c.vox.rig.node("LeftHand" as BN), r = c.vox.rig.node("RightHand" as BN);
      if (!l || !r) continue;
      l.computeWorldMatrix(true); r.computeWorldMatrix(true);
      const ly = l.getAbsolutePosition().y, ry = r.getAbsolutePosition().y;
      const b2 = game.ball.pos;
      const th = c.root.rotation.y + c.torsoTwist;
      const wx = b2.x - c.root.position.x, wz = b2.z - c.root.position.z;
      sideX.push(Math.cos(th) * wx - Math.sin(th) * wz);
      if (twoHandGrab(game, c, b2)) two++; else one++;
      if (Math.abs(ly - ry) < 0.08) continue;      // 両手上げ
      const up = ly > ry ? "L" : "R";              // 実際に高く上げているモデルの手
      const key = `利き腕 ${c.hand} / 番号側 ${c.numberSide > 0 ? "+1" : "-1"} → 上げた手 ${up}`;
      tally[key] = (tally[key] ?? 0) + 1;
      n++;
    }
  }
}
console.log(`ジャンプボールで片手を上げたフレーム ${n}（12 試合）`);
console.log("");
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}   ${v} フレーム`);
console.log("");
let same = 0, diff = 0;
for (const [k, v] of Object.entries(tally)) {
  const hand = /利き腕 R/.test(k) ? "R" : "L";
  const up = k.slice(-1);
  if (hand === up) same += v; else diff += v;
}
console.log(`利き腕を上げていた ${same} フレーム / 逆の手 ${diff} フレーム`);

const qq = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.floor(a.length * f)].toFixed(2) : "-";
console.log("");
console.log(`両手で伸ばしたフレーム ${two} / 片手 ${one}`);
console.log(`ボールの横位置（体の正面から。0 = 真正面）中央 ${qq(sideX.map(Math.abs), .5)}m  95% ${qq(sideX.map(Math.abs), .95)}m`);