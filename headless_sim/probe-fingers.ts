// 指の握りと、走る腕振りの個人差を実測する。
import "./stubs";
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
import { armStyleFor } from "../src/animation/basic/arm-style";
import { Quaternion } from "@babylonjs/core";
import { PALM_N } from "../src/animation/action/palm";
const { startRawPreload, rawReady } = await import("../src/objects/player/player-raw");
await startRawPreload();
console.log("生モデルの素材:", rawReady() ? "読めた" : "★読めていない");

const engine = new NullEngine(); const scene = new Scene(engine);
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();

const p0 = game.players[0];
const vb = p0.vox!;
type BN = Parameters<typeof vb.rig.node>[0];
const N = (b: string): Vector3 | null => vb.rig.node(b as BN)?.getAbsolutePosition() ?? null;
const RD = (b: string): Vector3 | null => vb.rig.restDirection(b as BN);

console.log("\n── 指のボーンが揃っているか ──");
const want: string[] = [];
for (const side of ["Left", "Right"]) for (const f of ["Thumb", "Index", "Middle", "Ring", "Little"])
  for (const s of ["Proximal", "Intermediate", "Distal"]) want.push(`${side}${f}${s}`);
console.log(`  ${want.filter((b) => vb.rig.node(b as BN)).length} / ${want.length} 本`);
console.log(`  静止方向が取れる ${want.filter((b) => RD(b)).length} / ${want.length} 本`);

// 手のひらの法線（fingers.ts と同じ式）
for (const side of ["Left", "Right"]) {
  const idx = vb.rig.restPosition(`${side}IndexProximal` as BN)!;
  const lit = vb.rig.restPosition(`${side}LittleProximal` as BN)!;
  const mid = vb.rig.restPosition(`${side}MiddleProximal` as BN)!;
  const hd = vb.rig.restPosition(`${side}Hand` as BN)!;
  const n = Vector3.Cross(lit.subtract(idx), mid.subtract(hd)).normalize();
  console.log(`  ${side} の手のひらの法線 (${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)})`);
}

// 握った時に指先が手のひらへ入るか（世界座標で、指先→手首の距離が縮むか）
function fingerReach(): { l: number; r: number } {
  const out = { l: 0, r: 0 };
  for (const side of ["Left", "Right"]) {
    const w = N(`${side}Hand`)!, t = N(`${side}MiddleDistal`);
    const v = t ? Vector3.Distance(w, t) : 0;
    if (side === "Left") out.l = v; else out.r = v;
  }
  return out;
}
// 胴から手までの距離（fingers.ts の openFor と同じ測り方）
function torsoGap(side: string): number {
  const a = N("Hips")!, b = N("Neck")!;
  const seg = (p: Vector3): number => {
    const ab = b.subtract(a); const l2 = ab.lengthSquared();
    const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / l2));
    return Vector3.Distance(p, a.add(ab.scale(t)));
  };
  return seg(N(`${side}Hand`)!) - seg(N(`${side}UpperArm`)!);
}

// ── 握る向きの独立検証 ──────────────────────────────────────
// fingers.ts は「指骨の向き × 手のひらの法線」で軸を決め、符号は中指の先が親指へ
// 近づく向きを選んでいる。ここではその計算を使わず、palm.ts が**メッシュから実測**した
// 手のひらの法線に対して、指先が手のひら側へ動いているかを見る。
console.log("");
console.log("── 握る向きの検証（palm.ts のメッシュ実測法線で判定）──");
for (const side of ["Left", "Right"]) {
  const rp = (b: string): Vector3 => vb.rig.restPosition(b as BN)!;
  const idx = rp(side + "IndexProximal"), lit = rp(side + "LittleProximal");
  const mid = rp(side + "MiddleProximal"), hd = rp(side + "Hand");
  const n = Vector3.Cross(lit.subtract(idx), mid.subtract(hd)).normalize();
  const dirMid = vb.rig.restDirection((side + "MiddleProximal") as BN)!;
  const ax = Vector3.Cross(dirMid, n).normalize();
  const tip = rp(side + "MiddleDistal"), th = rp(side + "ThumbDistal");
  const arm = tip.subtract(mid);
  const a = arm.rotateByQuaternionToRef(Quaternion.RotationAxis(ax, 0.9), new Vector3());
  const b = arm.rotateByQuaternionToRef(Quaternion.RotationAxis(ax, -0.9), new Vector3());
  const sign = Vector3.Distance(mid.add(a), th) <= Vector3.Distance(mid.add(b), th) ? 1 : -1;
  // 選ばれた向きで曲げたときの指先の移動を、メッシュ実測の法線へ射影する
  const moved = sign > 0 ? a : b;
  const delta = mid.add(moved).subtract(tip);
  const pn = (PALM_N as Record<string, Vector3>)[side + "Hand"];
  const along = Vector3.Dot(delta.normalize(), pn);
  console.log(`  ${side}: 選んだ符号 ${sign > 0 ? "+" : "-"} / 指先の動きと手のひら法線の内積 ${along.toFixed(3)}`
    + `  → ${along > 0.2 ? "手のひら側へ曲がる（正しい）" : along < -0.2 ? "★手の甲側へ曲がっている" : "★判定できない"}`);
}
const DT = 1 / 60;
console.log("\n── 場面ごとの「胴から手までの距離」と、指先〜手首の距離 ──");
console.log("  場面            左の距離 右の距離   指先〜手首(左/右)");
function snap(label: string): void {
  console.log(`  ${label.padEnd(14, "　")} ${torsoGap("Left").toFixed(3)}m  ${torsoGap("Right").toFixed(3)}m`
    + `   ${fingerReach().l.toFixed(3)} / ${fingerReach().r.toFixed(3)}`);
}
// 立っている（腕を垂らす）
for (let i = 0; i < 120; i++) game.update(DT);
snap("試合開始直後");
// 走る
for (let i = 0; i < 60 * 20; i++) game.update(DT);
snap("20秒後");
for (let i = 0; i < 60 * 40; i++) game.update(DT);
snap("60秒後");

console.log("\n── 腕の癖の散らばり（出場26人）──");
const gaps: number[] = [];
const tipThumb: number[] = [];
const wristTip: number[] = [];
for (let i = 0; i < 60 * 60; i++) {
  game.update(DT);
  if (i % 6) continue;
  for (const q2 of game.players) {
    const v = q2.vox; if (!v) continue;
    const nn = (b: string): Vector3 | null => v.rig.node(b as BN)?.getAbsolutePosition() ?? null;
    const a = nn("Hips"), b2 = nn("Neck"); if (!a || !b2) continue;
    const seg = (pt: Vector3): number => {
      const ab = b2.subtract(a); const l2 = ab.lengthSquared();
      const t = Math.max(0, Math.min(1, Vector3.Dot(pt.subtract(a), ab) / l2));
      return Vector3.Distance(pt, a.add(ab.scale(t)));
    };
    for (const side of ["Left", "Right"]) {
      const h = nn(side + "Hand"), sh = nn(side + "UpperArm");
      if (h && sh) gaps.push(seg(h) - seg(sh));
      const tip = nn(side + "MiddleDistal"), th = nn(side + "ThumbDistal");
      if (tip && th) tipThumb.push(Vector3.Distance(tip, th));
      if (tip && h) wristTip.push(Vector3.Distance(tip, h));
    }
  }
}
const qq = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(3) : "-";
console.log("");
console.log("── 胴から手までの距離の分布（26人×60秒、" + gaps.length + " 標本）──");
console.log(`  5% ${qq(gaps, .05)}m  25% ${qq(gaps, .25)}m  中央 ${qq(gaps, .5)}m  75% ${qq(gaps, .75)}m  95% ${qq(gaps, .95)}m`);
console.log(`  中指の先〜親指の先: 5% ${qq(tipThumb, .05)}m  中央 ${qq(tipThumb, .5)}m  95% ${qq(tipThumb, .95)}m`);
console.log(`  中指の先〜手首（開き切り 0.194m / 握るほど短い）: 最小 ${qq(wristTip, 0)}m  5% ${qq(wristTip, .05)}m  中央 ${qq(wristTip, .5)}m  最大 ${qq(wristTip, .999)}m`);
// ── ボールを持っている手が開いたままか ──────────────────────
const curlAll: number[] = [], curlBall: number[] = [];
for (let i = 0; i < 60 * 90; i++) {
  game.update(DT);
  if (i % 5) continue;
  const h = game.handler;
  for (const q3 of game.players) {
    const v = q3.vox; if (!v) continue;
    for (const side of ["Left", "Right"]) {
      const n2 = v.rig.node((side + "MiddleIntermediate") as BN);
      const rq = n2?.rotationQuaternion; if (!rq) continue;
      const ang = 2 * Math.acos(Math.min(1, Math.abs(rq.w))) * 180 / Math.PI;
      curlAll.push(ang);
      if (q3 === h) curlBall.push(ang);
    }
  }
}
const q4 = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(1) : "-";
console.log("");
console.log("── 中指の第2関節の曲がり角（0°=開き / 60°=握り切り）──");
console.log(`  全員      中央 ${q4(curlAll, .5)}°  5% ${q4(curlAll, .05)}°  95% ${q4(curlAll, .95)}°  (${curlAll.length} 標本)`);
console.log(`  ボール保持者 中央 ${q4(curlBall, .5)}°  95% ${q4(curlBall, .95)}°  (${curlBall.length} 標本)`);
const rows = game.players.map((p) => ({ n: p.name, s: armStyleFor(p) }));
const col = (f: (s: ReturnType<typeof armStyleFor>) => number): string => {
  const a = rows.map((r) => f(r.s)).sort((x, y) => x - y);
  return `${a[0].toFixed(2)} 〜 ${a[a.length - 1].toFixed(2)}（中央 ${a[a.length >> 1].toFixed(2)}）`;
};
console.log(`  振り幅の倍率   ${col((s) => s.swing)}`);
console.log(`  肘の抱えの倍率 ${col((s) => s.carry)}`);
console.log(`  肘の引き(左)   ${col((s) => s.pullL)} rad`);
console.log(`  肘の引き(右)   ${col((s) => s.pullR)} rad`);
console.log(`  体への寄り(左) ${col((s) => s.inL)} rad`);
console.log(`  体への寄り(右) ${col((s) => s.inR)} rad`);
console.log("\n  例（5人）");
for (const r of rows.slice(0, 5)) {
  console.log(`   ${r.n.padEnd(16, "　")} 振り${r.s.swing.toFixed(2)} 抱え${r.s.carry.toFixed(2)}`
    + ` 引きL${r.s.pullL.toFixed(2)}/R${r.s.pullR.toFixed(2)} 寄りL${r.s.inL.toFixed(2)}/R${r.s.inR.toFixed(2)}`);
}
console.log("\n60フレーム動かして例外なし");
