// ゲームの26人が生モデルで組まれているか、身長・髪型・色が選手ごとに出ているかを見る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, type Mesh, type StandardMaterial } from "@babylonjs/core";
const DIR = process.env.DIR ?? "public/vox/player_one";
const realFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
(globalThis as unknown as { fetch: unknown }) .fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try { const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
void realFetch;
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = false;
import { clubTeam } from "../src/roster";
const { startRawPreload, rawReady } = await import("../src/objects/player/player-raw");
await startRawPreload();
console.log("生モデルの素材:", rawReady() ? "読めた" : "★読めていない");

const engine = new NullEngine(); const scene = new Scene(engine);
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const t0 = Date.now();
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
console.log(`26人の組み立て: ${Date.now() - t0}ms`);
await new Promise((r) => setTimeout(r, 12000));   // 髪型は非同期で後から付く

/** メッシュの「頂点色 × diffuse」の平均。 */
function shown(m: Mesh): string {
  const c = m.getVerticesData("color"); const d = (m.material as StandardMaterial).diffuseColor;
  if (!c) return "-";
  const n = c.length / 4; let r = 0, gg = 0, b = 0;
  for (let i = 0; i < n; i++) { r += c[i * 4] * d.r; gg += c[i * 4 + 1] * d.g; b += c[i * 4 + 2] * d.b; }
  return [r, gg, b].map((v) => Math.round(Math.min(1, v / n) * 255)).join(",");
}
function extentY(ms: Mesh[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const m of ms) { m.computeWorldMatrix(true); m.refreshBoundingInfo();
    const bb = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, bb.minimumWorld.y); hi = Math.max(hi, bb.maximumWorld.y); }
  return [lo, hi];
}

let raw = 0, baked = 0;
const styles = new Set<string>();
console.log("\nチーム 番 選手           指定    実測    髪型            肌         髪");
for (let t = 0; t < 2; t++) {
  for (let i = 0; i < game.roster[t].length; i++) {
    const p = game.roster[t][i];
    const v = p.vox; if (!v) continue;
    const isRaw = v.meshes.some((m) => m.name.startsWith("body_"));
    if (isRaw) raw++; else { baked++; continue; }
    const hairM = v.meshes.find((m) => m.name.startsWith("hairstyle_"));
    if (hairM) styles.add(hairM.name.replace(/_\d+_\d+$/, ""));
    const body = v.meshes.find((m) => m.name.startsWith("body_"))!;
    const [lo] = extentY(v.meshes as Mesh[]);
    const [, hi] = extentY([body as Mesh]);
    if (i < 5 || i >= game.roster[t].length - 1) {
      console.log(`  ${t}  ${String(i).padStart(2)} ${p.name.slice(0, 12).padEnd(13)}`
        + ` ${(p.height * 100).toFixed(1)} ${((hi - lo) * 100).toFixed(1)}`
        + `  ${(hairM ? hairM.name.replace(/_\d+_\d+$/, "") : `髪なし(No=${p.look.hairNo})`).padEnd(15)}`
        + ` ${shown(body as Mesh).padEnd(11)} ${hairM ? shown(hairM as Mesh) : "-"}`);
    }
  }
}
console.log(`\n生モデル ${raw} 人 / 従来モデル ${baked} 人 / 使われた髪型 ${styles.size} 種`);

// 数フレーム動かして落ちないか
const p0 = game.roster[0][0];
p0.stand(); p0.resetFacing(); p0.lastDt = 1 / 60;
for (let i = 0; i < 60; i++) { p0.stridePhase += 0.2; p0.sync(); }
console.log("60フレーム動かして例外なし");

// 背番号の板が選手ごとに出ているか
{
  let panels = 0, texs = new Set<string>();
  for (let t = 0; t < 2; t++) for (const p of game.roster[t]) {
    p.setNumberSide(1);
    const sh = scene.meshes.find((m) => m.name === `rawnumshell_${t}_${game.roster[t].indexOf(p)}`);
    if (sh) { panels++; texs.add(p.jerseyText); }
  }
  console.log(`背番号の板 ${panels} / 26 枚、番号の種類 ${texs.size}`);
}
