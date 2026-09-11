// 26人が身長・体重どおりの体形になっているか。実際に描かれる高さと幅を測る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, type Mesh } from "@babylonjs/core";
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
await new Promise((r) => setTimeout(r, 8000));

console.log("名前            設定身長 体の高さ(髪を除く)  比  体重  肩幅");
const rows: { h: number; drawn: number; w: number; sh: number; k: number }[] = [];
for (const p of game.players) {
  const v = p.vox;
  if (!v) { console.log(`  ${p.name} : ボクセル無し`); continue; }
  let lo = Infinity, hi = -Infinity, xlo = Infinity, xhi = -Infinity;
  // ⚠️ 髪は選手ごとに形が違うので、体の高さの比較には入れない。
  //    （同じ 180cm の3人が 184.5 / 187.0 / 187.3cm とばらついていた原因）
  for (const m of (v.meshes as Mesh[]).filter((x) => !/hair/i.test(x.name))) {
    m.computeWorldMatrix(true); m.refreshBoundingInfo();
    const bb = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, bb.minimumWorld.y); hi = Math.max(hi, bb.maximumWorld.y);
    xlo = Math.min(xlo, bb.minimumWorld.x); xhi = Math.max(xhi, bb.maximumWorld.x);
  }
  const drawn = hi - lo, wide = xhi - xlo;
  const k = v.root.scaling.x;
  rows.push({ h: p.height, drawn, w: p.weight, sh: wide, k });
  console.log(`  ${String(p.jersey ?? "").padStart(2)} ${p.name.padEnd(14, "　")}`
    + ` ${(p.height * 100).toFixed(1)}cm  ${(drawn * 100).toFixed(1)}cm`
    + `  ${((drawn - p.height) * 100).toFixed(1)}  ${p.weight.toFixed(0)}kg`
    + `  ${(wide * 100).toFixed(1)}cm  ${k.toFixed(3)}`);
}
console.log("");

console.log("");
console.log("素体の実寸（IK が使う値）");
const shY: number[] = [], armL: number[] = [];
for (const p2 of game.players) {
  const v = p2.vox; if (!v) continue;
  shY.push(v.shoulder.y); armL.push(v.upperArm + v.foreArm);
  console.log("  " + p2.name.padEnd(14, "　")
    + " 肩 " + v.shoulder.y.toFixed(3) + "m"
    + " 上腕 " + v.upperArm.toFixed(3)
    + " 前腕 " + v.foreArm.toFixed(3)
    + " 腰 " + v.hipY.toFixed(3) + "m"
    + " 立ちリーチ " + (p2.height * 1.35).toFixed(3) + "m");
}
const sd = (a: number[]): number => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
};
const hs = rows.map((r) => r.h * 100), ds = rows.map((r) => r.drawn * 100);
const ws = rows.map((r) => r.w), ss = rows.map((r) => r.sh * 100);
const ks = rows.map((r) => r.k);
console.log(`\n設定身長   最小 ${Math.min(...hs).toFixed(1)} 最大 ${Math.max(...hs).toFixed(1)} ばらつき ${sd(hs).toFixed(2)}`);
console.log(`描かれた高さ 最小 ${Math.min(...ds).toFixed(1)} 最大 ${Math.max(...ds).toFixed(1)} ばらつき ${sd(ds).toFixed(2)}`);
console.log(`root倍率     最小 ${Math.min(...ks).toFixed(3)} 最大 ${Math.max(...ks).toFixed(3)} ばらつき ${sd(ks).toFixed(4)}`);
console.log(`体重         最小 ${Math.min(...ws).toFixed(0)} 最大 ${Math.max(...ws).toFixed(0)} ばらつき ${sd(ws).toFixed(2)}`);
console.log(`横幅         最小 ${Math.min(...ss).toFixed(1)} 最大 ${Math.max(...ss).toFixed(1)} ばらつき ${sd(ss).toFixed(2)}`);
// 相関: 身長 vs 描かれた高さ / 体重 vs 横幅
const corr = (a: number[], b: number[]): number => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
};
console.log(`\n相関 設定身長 vs 描かれた高さ ${corr(hs, ds).toFixed(3)}（1.0 なら完全に一致）`);
console.log(`相関 体重 vs 横幅            ${corr(ws, ss).toFixed(3)}`);

console.log("");
console.log();
console.log();
console.log();
console.log();
console.log("");
console.log("肩の高さ  最小 " + Math.min.apply(null, shY).toFixed(3)
  + " 最大 " + Math.max.apply(null, shY).toFixed(3) + " ばらつき " + sd(shY).toFixed(4));
console.log("腕の長さ  最小 " + Math.min.apply(null, armL).toFixed(3)
  + " 最大 " + Math.max.apply(null, armL).toFixed(3) + " ばらつき " + sd(armL).toFixed(4));
console.log("相関 設定身長 vs 肩の高さ " + corr(hs, shY).toFixed(3));
console.log("相関 設定身長 vs 腕の長さ " + corr(hs, armL).toFixed(3));
console.log("");
const ratios = rows.map((r) => r.drawn / r.h);
console.log("体の高さ ÷ 設定身長  最小 " + Math.min.apply(null, ratios).toFixed(4)
  + "  最大 " + Math.max.apply(null, ratios).toFixed(4)
  + "  ばらつき " + sd(ratios).toFixed(5));
const rng = (a) => Math.max.apply(null, a) - Math.min.apply(null, a);
console.log("設定身長の幅 " + rng(hs).toFixed(1) + "cm / 体の高さの幅 " + rng(ds).toFixed(1)
  + "cm → 倍率 " + (rng(ds) / rng(hs)).toFixed(3));