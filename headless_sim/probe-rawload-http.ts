// 開発サーバ越しに素材を読むのに何秒かかるかを測る（ゲーム起動時の競争の実測）。
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
const BASE = process.env.BASE ?? "http://localhost:5199";
const orig = globalThis.fetch;
(globalThis as unknown as { fetch: unknown }).fetch = (u: string) => orig(u.startsWith("http") ? u : BASE + u);
void new Scene(new NullEngine());
const { startRawPreload, rawReady } = await import("../src/objects/player/player-raw");
const t = Date.now();
await startRawPreload();
console.log(`素材の読み込み: ${Date.now() - t}ms  → ${rawReady() ? "読めた" : "★失敗"}`);
