// モデル確認ページ。voxel-pipeline が出力した**生のボクセル**を、モデル自身のスケルトンで
// 動かして見る。ゲーム用の焼き込み（body-*.json）は通さない。
import {
  Engine, Scene, Color3, Color4, Vector3, ArcRotateCamera,
  HemisphericLight, DirectionalLight, MeshBuilder,
} from "@babylonjs/core";
import { makeMat } from "./objects/materials";
import { MOTION_NAMES, motionClip, motionDuration, applyMotion } from "@objcts/player/motion/clip";
import { buildRawModel, type RawModel } from "./voxraw";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.06, 0.08, 1);

const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.35, 4.2, new Vector3(0, 1.0, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 0.8;
camera.upperRadiusLimit = 12;
camera.wheelDeltaPercentage = 0.02;

const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.95;
hemi.groundColor = new Color3(0.35, 0.35, 0.4);
const sun = new DirectionalLight("sun", new Vector3(0.3, -0.8, 0.5), scene);
sun.intensity = 1.05;

const floor = MeshBuilder.CreateGround("floor", { width: 8, height: 8, subdivisions: 8 }, scene);
floor.material = makeMat(scene, "floorMat", { diffuse: new Color3(0.16, 0.17, 0.2) });
const grid = MeshBuilder.CreateGround("grid", { width: 8, height: 8, subdivisions: 8 }, scene);
const gridMat = makeMat(scene, "gridMat", { emissive: new Color3(0.3, 0.32, 0.38), unlit: true });
gridMat.wireframe = true;
grid.material = gridMat;
grid.position.y = 0.002;

let model: RawModel | null = null;
let motion = "idle";
let playing = true;
let speed = 1;
let t = 0;
let info = "読み込み中…";
/** 表示中の髪型の部位名。"hair" = モデル本来の髪 / "" = 髪なし。 */
let hairPart = "hair";

/** 髪型を1つだけ表示する。 */
function showHair(name: string): void {
  if (!model) return;
  for (const [part, mesh] of model.byPart) {
    if (part === "hair" || part.startsWith("hairstyle_")) mesh.setEnabled(part === name);
  }
  hairPart = name;
}

/** 選んだクリップの t 秒地点をモデル自身のリグへ当てる。 */
function applyPose(time: number): void {
  if (!model) return;
  const clip = motionClip(motion);
  if (!clip) return;
  applyMotion(model.rig, clip, time % motionDuration(clip), { rootMotion: "vertical", leanDeg: 0 });
  // ⚠️ prepare() は同じ renderId 内だと即 return する。ここは描画前なので true で強制する。
  model.skel.prepare(true);   // リグ → スケルトン。GPU がウェイトでボクセルを変形する
}

async function load(): Promise<void> {
  model = await buildRawModel(scene, "/vox/player_one");
  camera.setTarget(new Vector3(0, model.height * 0.55, 0));
  camera.radius = model.height * 1.6;
  const bones = [...model.perBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([b, n]) => `${b} ${n.toLocaleString()}`);
  // 髪型セレクタの中身を、読み込んだ部位から作る
  hairSel.replaceChildren();
  const opts: [string, string][] = [["hair", "モデル本来の髪"], ["", "髪なし"]];
  for (const part of [...model.byPart.keys()].filter((k) => k.startsWith("hairstyle_")).sort()) {
    opts.push([part, "髪型 " + part.replace("hairstyle_", "")]);
  }
  for (const [v, label] of opts) {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    if (v === hairPart) o.selected = true;
    hairSel.appendChild(o);
  }
  info = `ボクセル ${model.voxelCount.toLocaleString()} / 三角形 ${model.triangles.toLocaleString()} / メッシュ ${model.meshes.length}\n`
    + `${bones.join("  ")}\n身長 ${model.height.toFixed(3)}m`;
  showHair(hairPart);
  applyPose(0);
}

// ---- UI -------------------------------------------------------------------
const ui = document.createElement("div");
Object.assign(ui.style, {
  position: "fixed", left: "12px", top: "12px", zIndex: "10",
  display: "flex", flexDirection: "column", gap: "8px",
  background: "rgba(12,15,22,0.88)", border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "12px", padding: "12px 14px", color: "#fff",
  font: "13px/1.4 'Segoe UI', system-ui, sans-serif", maxHeight: "92vh", overflow: "auto",
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(ui);

const row = (label: string): HTMLDivElement => {
  const d = document.createElement("div");
  Object.assign(d.style, { display: "flex", alignItems: "center", gap: "8px" });
  const l = document.createElement("span");
  l.textContent = label;
  Object.assign(l.style, { opacity: "0.7", minWidth: "64px", fontSize: "12px" });
  d.appendChild(l);
  ui.appendChild(d);
  return d;
};
const button = (parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement("button");
  b.textContent = label;
  Object.assign(b.style, {
    background: "rgba(20,24,34,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "8px", padding: "5px 10px", fontSize: "12px", cursor: "pointer",
  } as Partial<CSSStyleDeclaration>);
  b.onclick = onClick;
  parent.appendChild(b);
  return b;
};

const title = document.createElement("div");
title.textContent = "モデル確認（生のボクセル）";
Object.assign(title.style, { fontWeight: "800", fontSize: "15px", letterSpacing: "1px" });
ui.appendChild(title);

const sel = document.createElement("select");
Object.assign(sel.style, {
  background: "rgba(20,24,34,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: "8px", padding: "4px 6px", fontSize: "12px", flex: "1", minWidth: "0",
} as Partial<CSSStyleDeclaration>);
for (const n of MOTION_NAMES.slice().sort()) {
  const o = document.createElement("option");
  o.value = n; o.textContent = n;
  if (n === motion) o.selected = true;
  sel.appendChild(o);
}
sel.onchange = () => { motion = sel.value; t = 0; applyPose(0); };
row("モーション").appendChild(sel);

// 髪型のセレクタ（モデル本来の髪 / 差し替え用の髪型 / 無し）
const hairSel = document.createElement("select");
Object.assign(hairSel.style, {
  background: "rgba(20,24,34,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: "8px", padding: "4px 6px", fontSize: "12px", flex: "1", minWidth: "0",
} as Partial<CSSStyleDeclaration>);
hairSel.onchange = () => showHair(hairSel.value);
row("髪型").appendChild(hairSel);

const ctl = row("再生");
const playBtn = button(ctl, "⏸ 停止", () => {
  playing = !playing;
  playBtn.textContent = playing ? "⏸ 停止" : "▶ 再生";
});
button(ctl, "1コマ", () => { t += 1 / 30; applyPose(t); });
button(ctl, "頭出し", () => { t = 0; applyPose(0); });

const spd = row("速さ");
for (const s of [0.25, 0.5, 1, 2]) button(spd, `${s}x`, () => { speed = s; });

const infoEl = document.createElement("div");
Object.assign(infoEl.style, {
  fontSize: "11px", opacity: "0.7", lineHeight: "1.6", maxWidth: "240px", whiteSpace: "pre-line",
});
ui.appendChild(infoEl);

load().catch((e: unknown) => {
  info = "★ 読み込みに失敗: " + (e instanceof Error ? e.message : String(e));
  console.error(e);
});

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (playing && model) { t += dt * speed; applyPose(t); }
  const clip = motionClip(motion);
  const dur = clip ? motionDuration(clip) : 0;
  infoEl.textContent = info
    + `\n${motion} ${dur ? (t % dur).toFixed(2) : "0.00"}/${dur.toFixed(2)}s`
    + `\n${Math.round(engine.getFps())} fps ｜ ドラッグで回転・ホイールで拡大`;
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
