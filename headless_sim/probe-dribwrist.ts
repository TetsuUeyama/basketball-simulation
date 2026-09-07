// ドリブル中、手のひらを水平にするために手首をどれだけ曲げているか。
// 肘の曲げ・前腕の傾きも一緒に見て、負担が手首に寄っていないか調べる。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, Quaternion } from "@babylonjs/core";
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
import { PALM_N } from "../src/animation/action/palm";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
type BN = Parameters<NonNullable<Player["vox"]>["rig"]["node"]>[0];
const UP = new Vector3(0, 1, 0);
const DEG = 180 / Math.PI;

const wrist: number[] = [], elbow: number[] = [], fore: number[] = [], tilt: number[] = [];
const reach: number[] = [], armLen: number[] = [], sideOff: number[] = [], ballOff: number[] = [];
const elbOut: number[] = [], balOut: number[] = [];
const elbBack: number[] = [];
for (let gi = 0; gi < 3; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 3);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 2; i++) {
    game.update(DT);
    const h = game.handler;
    if (!h?.vox || !h.dribbleArm) continue;
    const useLeft = (h.dribbleArm === "R") === (h.numberSide > 0);
    const hb = useLeft ? "LeftHand" : "RightHand";
    const eb = useLeft ? "LeftLowerArm" : "RightLowerArm";
    const hn = h.vox.rig.node(hb as BN), en = h.vox.rig.node(eb as BN);
    if (!hn || !en) continue;
    // 腕の長さと、肩から狙い(ボールのx/z・高さ0.95m)までの距離
    {
      const sh = h.vox.rig.node((useLeft ? "LeftUpperArm" : "RightUpperArm") as BN);
      if (sh) {
        sh.computeWorldMatrix(true);
        const sp = sh.getAbsolutePosition();
        const L = h.upperArmLen + h.foreArmLen;
        armLen.push(L);
        reach.push(Math.hypot(game.ball.pos.x - sp.x, 0.95 - sp.y, game.ball.pos.z - sp.z));
        sideOff.push(Math.hypot(game.ball.pos.x - sp.x, game.ball.pos.z - sp.z));
        ballOff.push(Math.hypot(game.ball.pos.x - h.pos.x, game.ball.pos.z - h.pos.z));
      }
    }
    // 肘とボールが、体の中心からどれだけ外に出ているか
    {
      const el = h.vox.rig.node((useLeft ? "LeftLowerArm" : "RightLowerArm") as BN);
      if (el) {
        el.computeWorldMatrix(true);
        const ep = el.getAbsolutePosition();
        elbOut.push(Math.hypot(ep.x - h.pos.x, ep.z - h.pos.z));
        // 体の前後方向で肘がどこにあるか（負 = 後ろ）。前方は -numberSide·Z を root ヨーで回した向き。
        {
          const th = h.root.rotation.y;
          const fx = -h.numberSide * Math.sin(th), fz = -h.numberSide * Math.cos(th);
          elbBack.push((ep.x - h.pos.x) * fx + (ep.z - h.pos.z) * fz);
        }
        balOut.push(Math.hypot(game.ball.pos.x - h.pos.x, game.ball.pos.z - h.pos.z));
      }
    }
    // 手首: 手ボーンの局所回転そのもの（levelDribbleHand が書いた補正）
    const q = hn.rotationQuaternion;
    if (q) wrist.push(2 * Math.acos(Math.min(1, Math.abs(q.w))) * DEG);
    // 肘: 前腕ボーンの局所回転
    const qe = en.rotationQuaternion;
    if (qe) elbow.push(2 * Math.acos(Math.min(1, Math.abs(qe.w))) * DEG);
    // 前腕が鉛直からどれだけ傾いているか（0° = 真下を向いている）
    en.computeWorldMatrix(true); hn.computeWorldMatrix(true);
    const dir = hn.getAbsolutePosition().subtract(en.getAbsolutePosition());
    if (dir.lengthSquared() > 1e-6) {
      fore.push(Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(dir.normalize(), UP.scale(-1))))) * DEG);
    }
    // 手のひらが水平からどれだけ傾いているか（0° = 床と平行）
    {
      const m = hn.getWorldMatrix();
      const o = Vector3.TransformCoordinates(Vector3.Zero(), m);
      const n = Vector3.TransformCoordinates((PALM_N as Record<string, Vector3>)[hb], m).subtract(o).normalize();
      tilt.push(Math.acos(Math.min(1, Math.abs(Vector3.Dot(n, UP)))) * DEG);
    }
  }
}
void Quaternion;
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(1) : "-";
console.log(`ドリブル中のフレーム ${wrist.length}（3試合）`);
console.log(`  手首の曲げ   中央 ${q(wrist, .5)}°  75% ${q(wrist, .75)}°  95% ${q(wrist, .95)}°  最大 ${q(wrist, .999)}°`);
console.log(`  肘の曲げ     中央 ${q(elbow, .5)}°  75% ${q(elbow, .75)}°  95% ${q(elbow, .95)}°`);
console.log(`  前腕の傾き   中央 ${q(fore, .5)}°  75% ${q(fore, .75)}°  95% ${q(fore, .95)}°（0°=真下）`);
console.log(`  手のひらの傾き 中央 ${q(tilt, .5)}°  95% ${q(tilt, .95)}°（0°=床と平行）`);
console.log("");
console.log(`  腕の長さ(上腕+前腕) 中央 ${q(armLen, .5)}m`);
console.log(`  肩から狙いまでの距離 中央 ${q(reach, .5)}m  25% ${q(reach, .25)}m  75% ${q(reach, .75)}m`);
console.log(`  → IK が解けるのは 腕の長さ×0.97 未満のときだけ`);
console.log(`  肩からボールまでの横距離 中央 ${q(sideOff, .5)}m / 体からボールまで 中央 ${q(ballOff, .5)}m`);
const q2 = (arr: number[], f: number): string => arr.length
  ? [...arr].sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(arr.length * f))].toFixed(3) : "-";
console.log(`  体の中心からの横距離: 肘 ${q2(elbOut, .5)}m / ボール ${q2(balOut, .5)}m`);
console.log(`  肘の前後位置 中央 ${q2(elbBack, .5)}m（負 = 体より後ろ）`);
console.log(`\n人の手首が無理なく曲がるのは 60〜70° まで。`);
