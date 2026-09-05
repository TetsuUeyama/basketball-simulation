// 放送カメラの画に入っているメッシュだけが描かれているかを見る。
// NullEngine でもラスタライズしないだけで、描くメッシュの選別（視錐台カリング）は走る。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, Vector3, type Mesh } from "@babylonjs/core";
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
import { UniversalCamera } from "@babylonjs/core";
const { startRawPreload } = await import("../src/objects/player/player-raw");
await startRawPreload();

const engine = new NullEngine({ renderWidth: 1600, renderHeight: 900 });
const scene = new Scene(engine);
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
clubTeam(0, 0); clubTeam(1, 1);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
await new Promise((r) => setTimeout(r, 8000));       // 髪型が届くのを待つ

// 放送カメラに近い画（サイドライン外、コート中央を見る）
const cam = new UniversalCamera("c", new Vector3(0, 8, -16), scene);
cam.setTarget(new Vector3(0, 1.5, 0));
cam.fov = 0.7;
scene.activeCamera = cam;
for (let i = 0; i < 3; i++) { for (const p of game.allPlayers(0).concat(game.allPlayers(1))) p.sync(); scene.render(); }

// 選手のメッシュは近景ぶんと遠景ぶんの両方がシーンに居る。名前で拾う。
const parts = ["body", "hair", "hairstyle_", "jersey", "jerseymark", "shorts", "socks", "shoes", "face"];
const isPlayerMesh = (n: string) => parts.some((q) => n.startsWith(q) || n.startsWith("lod_" + q));
let fine = 0, fineTri = 0, coarse = 0, coarseTri = 0;
for (const mm of scene.meshes) {
  if (!isPlayerMesh(mm.name)) continue;
  const t = (mm as Mesh).getTotalIndices() / 3;
  if (mm.name.startsWith("lod_")) { coarse++; coarseTri += t; } else { fine++; fineTri += t; }
}
console.log(`用意したメッシュ: 近景 ${fine} 個 / ${(fineTri / 1e6).toFixed(2)}M   遠景 ${coarse} 個 / ${(coarseTri / 1e6).toFixed(2)}M`);

let actF = 0, actFT = 0, actC = 0, actCT = 0;
const act = scene.getActiveMeshes();
for (let i2 = 0; i2 < act.length; i2++) {
  const mm = act.data[i2];
  if (!isPlayerMesh(mm.name)) continue;
  const t = (mm as Mesh).getTotalIndices() / 3;
  if (mm.name.startsWith("lod_")) { actC++; actCT += t; } else { actF++; actFT += t; }
}
console.log(`実際に描かれた:   近景 ${actF} 個 / ${(actFT / 1e6).toFixed(2)}M   遠景 ${actC} 個 / ${(actCT / 1e6).toFixed(2)}M`);
console.log(`合計 ${actF + actC} 個 / ${((actFT + actCT) / 1e6).toFixed(2)}M 三角形`);

// 近づいたときは細かい版に戻るか
cam.position = new Vector3(2, 1.6, -3);
cam.setTarget(new Vector3(game.roster[0][0].pos.x, 1.2, game.roster[0][0].pos.z));
game.roster[0][0].pos.set(2, 0, 0);
for (const p of game.allPlayers(0).concat(game.allPlayers(1))) p.sync();
scene.render(); scene.render();
let nf = 0, nc = 0;
const act3 = scene.getActiveMeshes();
for (let i3 = 0; i3 < act3.length; i3++) {
  const n = act3.data[i3].name;
  if (!isPlayerMesh(n)) continue;
  if (n.startsWith("lod_")) nc++; else nf++;
}
console.log(`\n選手に寄ったとき: 近景 ${nf} 個 / 遠景 ${nc} 個`);
