// 腕の揺れが脚の倍になっているかを、実効値・角度・実際の移動量の3段で確かめる。
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
const p = game.roster[0][0];
p.stand(); p.pos.set(0, 0, 0); p.setNumberSide(1); p.root.rotation.y = 0; p.lastDt = 1 / 60;

const at = (b: string): Vector3 => {
  const n = p.vox!.rig.node(b as never)!; n.computeWorldMatrix(true);
  return n.getAbsolutePosition();
};
type Range = { lo: number; hi: number };
const track = new Map<string, Range>();
const put = (k: string, v: number): void => {
  const r = track.get(k);
  if (!r) track.set(k, { lo: v, hi: v });
  else { r.lo = Math.min(r.lo, v); r.hi = Math.max(r.hi, v); }
};

const BASE = Number(process.env.BASE_UPRIGHT ?? 1.0);
for (let i = 0; i < 60 * 30; i++) {          // 30秒ぶん
  p.upright = p.uprightTarget = BASE;
  p.sync();
  if (i < 120) continue;                      // 立ち上がりを捨てる
  p.root.computeWorldMatrix(true);
  // ① 実効値
  put("s:腿(左)", 1 - stanceS(p, G.thighL));
  put("s:脛(左)", 1 - stanceS(p, G.shinL));
  put("s:上腕(左)", 1 - stanceS(p, G.armL));
  put("s:前腕(左)", 1 - stanceS(p, G.foreL));
  // ② 角度（真下からの開き）
  const ang = (a: string, b: string): number => {
    const d = at(b).subtract(at(a));
    return Math.acos(Math.min(1, Math.max(-1, -d.y / d.length()))) * 180 / Math.PI;
  };
  put("角度:腿(左)", ang("LeftUpperLeg", "LeftLowerLeg"));
  put("角度:上腕(左)", ang("LeftUpperArm", "LeftLowerArm"));
  put("角度:前腕(左)", ang("LeftLowerArm", "LeftHand"));
  // ③ 実際の移動量（体の中心から見た位置）
  const knee = at("LeftLowerLeg").subtract(p.pos);
  const hand = at("LeftHand").subtract(p.pos);
  put("位置:膝の前後(mm)", knee.z * 1000);
  put("位置:手の前後(mm)", hand.z * 1000);
  put("位置:手の上下(mm)", hand.y * 1000);
}
console.log(`直立度 ${BASE.toFixed(2)} で 30 秒ぶん動かしたときの振れ幅`);
for (const [k, r] of track) {
  const w = r.hi - r.lo;
  console.log(`  ${k.padEnd(18)} ${r.lo.toFixed(3).padStart(9)} 〜 ${r.hi.toFixed(3).padStart(9)}`
    + `  振れ幅 ${w.toFixed(3)}`);
}
