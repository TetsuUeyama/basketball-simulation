// ドリブル中、空いている手（オフアーム）が相手のどこを押しているか。
// 相手の体を「腰=0 / 胸=1 / 肩=2 / 頭=3」の目盛りにして、手の高さがどこに来るか見る。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
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
import { dist2D } from "../src/util";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
type BN = Parameters<NonNullable<Player["vox"]>["rig"]["node"]>[0];

const level: number[] = [];      // 相手の体のどの高さか（0=腰 1=胸 2=肩 3=頭）
const gapToBody: number[] = [];  // 手と相手の体の中心線までの水平距離
const nearHand: number[] = [];   // 相手の伸ばした手までの距離
let frames = 0, reaching = 0;
const touch: number[] = [], elbow: number[] = [];
const touchNear: number[] = [];   // 届く距離(相手が1.0m以内)だけ
const touchIn: number[] = [];     // 肩から狙いまでが腕の届く範囲だったときだけ
const pushLv: number[] = [];      // 胴体を押している場面だけの高さ
let swipeN = 0, pushN = 0;
const swipeSpd: number[] = [], pushSpd: number[] = [];
let prevHand: Vector3 | null = null, prevWasSwipe = false, prevP: Player | null = null;
for (let gi = 0; gi < 3; gi++) {
  clubTeam(0, gi); clubTeam(1, gi + 3);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 2; i++) {
    game.update(DT);
    const h = game.handler;
    if (!h?.vox || !h.dribbleArm) continue;
    const d = game.onBallDefender(h);
    if (!d?.vox || d.seated || dist2D(d.pos, h.pos) >= 1.9) continue;
    frames++;
    const useLeft = (h.dribbleArm === "R") === (h.numberSide > 0);
    const offBone = useLeft ? "RightHand" : "LeftHand";   // ドリブルと逆の手
    const on = h.vox.rig.node(offBone as BN);
    if (!on) continue;
    on.computeWorldMatrix(true);
    const hp = on.getAbsolutePosition();
    // 相手の体の目盛り
    const hip = d.pos.y + d.height * 0.52, chest = d.pos.y + d.height * 0.72;
    const sho = d.pos.y + d.height * 0.83, head = d.pos.y + d.height * 0.94;
    const marks = [hip, chest, sho, head];
    let lv = 0;
    if (hp.y <= marks[0]) lv = (hp.y - marks[0]) / (marks[1] - marks[0]);
    else { for (let k = 0; k < 3; k++) if (hp.y >= marks[k] && hp.y <= marks[k + 1]) lv = k + (hp.y - marks[k]) / (marks[k + 1] - marks[k]); }
    if (hp.y > marks[3]) lv = 3 + (hp.y - marks[3]) / (marks[1] - marks[0]);
    level.push(lv);
    gapToBody.push(Math.hypot(hp.x - d.pos.x, hp.z - d.pos.z));
    // 手のひらが狙いに接しているか（狙い = 伸ばしてきた手、無ければ胴体）
    {
      const { reachingHand, GUARD_CHEST } = await import("../src/animation/action/dribble");
      const rh = reachingHand(d, h);
      if (rh) swipeN++; else { pushN++; pushLv.push(lv); }
      // 手の動き（体の動きを差し引いた、手そのものの速さ）
      if (prevHand && prevP === h) {
        const v = Vector3.Distance(hp, prevHand) / DT;
        if (prevWasSwipe) swipeSpd.push(v); else pushSpd.push(v);
      }
      prevHand = hp.clone(); prevWasSwipe = !!rh; prevP = h;
      const tgt = rh ?? new Vector3(d.pos.x, d.pos.y + d.height * GUARD_CHEST, d.pos.z);
      // 手のひらは手首(手ボーン)から 0.135m 先。肩→手首の向きに伸ばして当たり点を出す。
      const sh = h.vox.rig.node((useLeft ? "RightUpperArm" : "LeftUpperArm") as BN);
      if (sh) {
        sh.computeWorldMatrix(true);
        const sp = sh.getAbsolutePosition();
        const dv = hp.subtract(sp); const dl2 = dv.length() || 1;
        const palm = hp.add(dv.scale(0.135 / dl2));
        touch.push(Vector3.Distance(palm, tgt));
        if (dist2D(d.pos, h.pos) < 1.0) touchNear.push(Vector3.Distance(palm, tgt));
        const need = Vector3.Distance(sp, tgt);
        if (need <= h.upperArmLen + h.foreArmLen + 0.135) touchIn.push(Vector3.Distance(palm, tgt));
      }
      const el = h.vox.rig.node((useLeft ? "RightLowerArm" : "LeftLowerArm") as BN);
      const eq = el?.rotationQuaternion;
      if (eq) elbow.push(2 * Math.acos(Math.min(1, Math.abs(eq.w))) * 180 / Math.PI);
    }
    // 相手が手を伸ばしているか（相手の手がハンドラーへ近いか）
    let best = Infinity;
    for (const b of ["LeftHand", "RightHand"] as const) {
      const dn = d.vox.rig.node(b as BN);
      if (!dn) continue;
      dn.computeWorldMatrix(true);
      const dp = dn.getAbsolutePosition();
      best = Math.min(best, Math.hypot(dp.x - h.pos.x, dp.z - h.pos.z));
    }
    if (best < Infinity) { nearHand.push(best); if (best < 0.75) reaching++; }
  }
}
void Vector3;
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
console.log(`相手が 1.9m 以内でドリブルしているフレーム ${frames}（3試合）`);
console.log(`\n押している高さ（0=腰 1=胸 2=肩 3=頭、3超=顔より上）`);
console.log(`  中央 ${q(level, .5)}  25% ${q(level, .25)}  75% ${q(level, .75)}  95% ${q(level, .95)}`);
const above = level.filter((v) => v >= 2).length;
console.log(`  肩より上を押している ${above} / ${level.length}（${(above / Math.max(1, level.length) * 100).toFixed(0)}%）`);
const face = level.filter((v) => v >= 2.6).length;
console.log(`  顔のあたり(2.6以上) ${face} / ${level.length}（${(face / Math.max(1, level.length) * 100).toFixed(0)}%）`);
console.log(`\n手と相手の体の中心までの水平距離 中央 ${q(gapToBody, .5)}m`);
console.log(`相手の手がハンドラーへ近い(0.75m以内)フレーム ${reaching} / ${nearHand.length}`);
console.log(`
手のひらと狙いの距離 中央 ${q(touch, .5)}m  25% ${q(touch, .25)}m  75% ${q(touch, .75)}m`);
console.log(`押している腕の肘の曲げ 中央 ${q(elbow, .5)}°  25% ${q(elbow, .25)}°  75% ${q(elbow, .75)}°`);
console.log(`
届く距離(相手が1.0m以内)だけ: 手のひらと狙いの距離 中央 ${q(touchNear, .5)}m  75% ${q(touchNear, .75)}m（${touchNear.length} 標本）`);
console.log(`肩から狙いまでが腕の届く範囲だった場面: 手のひらと狙いの距離 中央 ${q(touchIn, .5)}m  75% ${q(touchIn, .75)}m（${touchIn.length} 標本）`);
console.log(`場面の内訳: 胴体を押す ${pushN} / 手を払う ${swipeN}`);
console.log(`オフアームの手の速さ: 押す 中央 ${q(pushSpd, .5)}m/s / 払う 中央 ${q(swipeSpd, .5)}m/s  95% ${q(swipeSpd, .95)}m/s`);
console.log(`胴体を押す場面の高さ 中央 ${q(pushLv, .5)}  95% ${q(pushLv, .95)}  肩より上 ${pushLv.filter((v) => v >= 2).length} / ${pushLv.length}`);
console.log(`  相手の手までの距離 中央 ${q(nearHand, .5)}m  25% ${q(nearHand, .25)}m`);
