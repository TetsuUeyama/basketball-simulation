// 選手ごとの顔（あご・目・位置・口）がデータベースから配られているかと、その作り分けの費用。
// ⚠️ 顔メッシュは選手ごと、本体メッシュは**あごが同じ選手で共有**。ここで両方を数える。
import "./stubs";
import { readFileSync } from "node:fs";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";

const DIR = "public/vox/player_one";
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = String(url).split("/").pop()!;
  try {
    const buf = readFileSync(`${DIR}/${name}`);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => ab };
  } catch { return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
};
const { startRawPreload, buildRawVoxelBody } = await import("../src/objects/player/player-raw");
const { playerLook } = await import("../src/objects/player/player-look");
const { ROSTER } = await import("../src/roster");
await startRawPreload();

const engine = new NullEngine();
const KIT = { top: { r: .8, g: .1, b: .1 }, bottom: { r: .8, g: .1, b: .1 }, shoes: { r: 1, g: 1, b: 1 } };

// --- 1. データベースが配った顔のばらけ方 ---
// ⚠️ ROSTER は「チームごとの選手定義の配列」。row[0] を文字列にすると [object Object] になる。
const names: string[] = [];
for (const team of ROSTER) for (const d of team as { name: string }[]) names.push(d.name);
const faces = names.map((n) => playerLook(n).face);
const tally = (get: (f: typeof faces[0]) => string): string => {
  const m = new Map<string, number>();
  for (const f of faces) m.set(get(f), (m.get(get(f)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + "×" + n).join(" ");
};
console.log("ロスター " + names.length + "人の顔の配られ方");
console.log("  あご  : " + tally((f) => f.jaw));
console.log("  目    : " + tally((f) => f.eye));
console.log("  目の位置: " + tally((f) => f.eyeX + "," + f.eyeY));
console.log("  口    : " + tally((f) => f.mouth));
const combo = new Set(faces.map((f) => f.jaw + f.eye + f.eyeX + f.eyeY + f.mouth));
console.log("  組み合わせの種類: " + combo.size + " / " + names.length + "人");
// ⚠️ 同じ名前なら常に同じ顔でなければならない（チームや並び順で変わらないこと）
const again = names.map((n) => playerLook(n).face);
const stable = faces.every((f, i) =>
  f.jaw === again[i].jaw && f.eye === again[i].eye && f.mouth === again[i].mouth
  && f.eyeX === again[i].eyeX && f.eyeY === again[i].eyeY);
console.log("  同じ名前で同じ顔になるか: " + (stable ? "はい" : "いいえ"));

// --- 2. 実際に組んで、顔メッシュが選手ごとに違うか ---
const scene = new Scene(engine);
const root = new TransformNode("p", scene);
const built: { name: string; face: string; faceVerts: number; bodyVerts: number }[] = [];
const bodies = new Set<unknown>(), facesMesh = new Set<unknown>();
for (const n of names.slice(0, 26)) {
  const look = playerLook(n);
  const b = buildRawVoxelBody(scene, root, {
    name: "t" + built.length, balance: 50, height: 1.85, weight: 80,
    skin: look.skin, hair: look.hair, hairNo: look.hairNo, face: look.face,
    kit: KIT, jerseyText: "8",
  });
  if (!b) { console.log("組めない: " + n); break; }
  const body = b.meshes.find((m) => m.name.startsWith("body_"));
  const fm = b.meshes.find((m) => m.name.startsWith("face_"));
  if (body) bodies.add(body.geometry);
  if (fm) facesMesh.add(fm.geometry);
  built.push({
    name: n, face: look.face.jaw + "/" + look.face.eye + "/" + look.face.eyeX + "," + look.face.eyeY
      + "/" + look.face.mouth,
    faceVerts: fm?.getTotalVertices() ?? 0, bodyVerts: body?.getTotalVertices() ?? 0,
  });
}
console.log("\n組んだ " + built.length + "人（先頭8人）");
for (const b of built.slice(0, 8)) {
  console.log("  " + b.name.padEnd(16) + b.face.padEnd(34)
    + " 顔 " + b.faceVerts + "頂点 / 本体 " + b.bodyVerts + "頂点");
}
console.log("本体のジオメトリ実体: " + bodies.size + " 種（あごの数だけのはず）");
console.log("顔のジオメトリ実体  : " + facesMesh.size + " 種（顔の組み合わせの数だけのはず）");
const faceTotal = built.reduce((s, b) => s + b.faceVerts, 0);
console.log("顔の頂点 合計: " + faceTotal.toLocaleString() + "（26人ぶん）");
