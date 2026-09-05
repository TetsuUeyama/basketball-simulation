// main.ts と同じ順番（先読みは待たない → しばらくしてから世界を組む）で、
// 実際にどちらのモデルが使われるかを見る。素材は開発サーバから読む。
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
const BASE = process.env.BASE ?? "http://localhost:5199";
const orig = globalThis.fetch;
(globalThis as unknown as { fetch: unknown }).fetch = (u: string) => orig(u.startsWith("http") ? u : BASE + u);
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = false;
import { clubTeam } from "../src/roster";
const { startRawPreload, rawReady, onRawReady } = await import("../src/objects/player/player-raw");

const t0 = Date.now();
void startRawPreload();                       // main.ts と同じく待たない
const WAIT = Number(process.env.WAIT ?? 2000);  // タイトル画面に居る時間の代わり
await new Promise((r) => setTimeout(r, WAIT));
console.log(`起動から ${Date.now() - t0}ms で世界を組む。素材は ${rawReady() ? "読めている" : "★まだ"}`);

const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
let raw = 0, baked = 0;
for (let t = 0; t < 2; t++) for (const p of game.roster[t]) {
  if (p.vox?.meshes.some((m) => m.name.startsWith("body_"))) raw++; else baked++;
}
console.log(`生モデル ${raw} 人 / 従来モデル ${baked} 人`);

// main.ts と同じく、遅れて届いたら組み直す
await new Promise<void>((r) => onRawReady(() => r()));
for (let t = 0; t < 2; t++) for (const pl of game.allPlayers(t)) pl.rebuildVoxel();
let raw2 = 0, baked2 = 0;
for (let t = 0; t < 2; t++) for (const pl of game.roster[t]) {
  if (pl.vox?.meshes.some((m) => m.name.startsWith("body_"))) raw2++; else baked2++;
}
console.log(`素材が届いたあと組み直し → 生モデル ${raw2} 人 / 従来モデル ${baked2} 人 (${Date.now() - t0}ms)`);
