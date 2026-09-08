// 床のルーズボールがどう確保されているか。腰を折って手を伸ばしているか、
// 相手と競って弾き合いが起きるか。
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
import { dist2DTo } from "../src/util";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 6);

let lowFrames = 0, lowSecured = 0, lowTimeout = 0, lowScenes = 0;
const scoop: number[] = [];       // 床の球の近く(1.6m以内)に居る選手の屈み具合
const lowHold: number[] = [];     // 床に転がっている時間(秒)
let tipsLow = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasLow = false, lowT = 0, tips0 = 0;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const loose = game.ballMode === "loose";
    const low = loose && game.ball.pos.y < 0.45;
    if (low) {
      lowFrames++; lowT += DT;
      if (!wasLow) { lowScenes++; tips0 = (game as unknown as { looseTips: number }).looseTips; }
      for (const p of game.players) {
        if (dist2DTo(game.ball.pos, p.pos.x, p.pos.z) < 1.6) scoop.push(p.scoopLoad);
      }
    }
    const beforeT = (game as unknown as { looseTips: number }).looseTips;
    game.update(DT);
    const afterT = (game as unknown as { looseTips: number }).looseTips;
    if (low && afterT > beforeT) tipsLow++;
    if (wasLow && game.ballMode !== "loose") {
      lowHold.push(lowT);
      if (game.handler) lowSecured++; else lowTimeout++;
      void tips0;
      lowT = 0;
    }
    if (!low) { if (wasLow) lowT = 0; }
    wasLow = low;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`${NG} 試合`);
console.log(`床にボールがあったフレーム ${lowFrames} / 場面 ${lowScenes}`);
console.log(`  そのまま確保された ${lowSecured} 回 / 誰も持たずに終わった ${lowTimeout} 回`);
console.log(`  床に転がっていた時間 中央 ${q(lowHold, .5)}秒  75% ${q(lowHold, .75)}秒`);
console.log(`  床の球を弾いた回数 ${tipsLow}`);
console.log(`\n床の球の 1.6m 以内に居る選手の屈み具合（0=直立 1=腰を折り切り）`);
console.log(`  中央 ${q(scoop, .5)}  75% ${q(scoop, .75)}  95% ${q(scoop, .95)}`);
