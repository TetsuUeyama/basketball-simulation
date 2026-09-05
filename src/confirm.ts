// モデル確認ページ。
// ⚠️ 以前はここだけクリップを素のリグへ直接流していたので、**試合中と別物**が見えていた。
//    確認の意味が無くなるので、ゲームとまったく同じ経路（Player.sync → applyClipPose →
//    ボーンの読み替え・腕の開き・構え・姿勢の繋ぎ）で動かす。ここで見えるものが試合で出る。
import {
  Engine, Scene, Color3, Color4, Vector3, ArcRotateCamera,
  HemisphericLight, DirectionalLight, MeshBuilder,
} from "@babylonjs/core";
import { makeMat } from "./objects/materials";
import { MOTION_NAMES, motionClip, motionDuration } from "@objcts/player/motion/clip";
import { Player } from "./objects/player/player";
import { ROSTER } from "./roster";
import { rawPrototype, startRawPreload } from "./objects/player/player-raw";
import type { JawShape, RawModel } from "./voxraw";
// ⚠️ Player の各メソッドは副作用インポートで prototype に生える。1つでも欠けると
//    sync() の途中で undefined を呼んで落ちる。ゲーム本体と同じ顔ぶれを読む。
import "./objects/player/player-state";
import "./objects/player/player-query";
import "./objects/player/player-roster";
import "./objects/player/player-visual";
import "./animation/basic/arms";
import "./animation/basic/torso";
import "./animation/action/dribble";
import "./animation/action/guard";
import "./animation/action/hold";
import "./animation/action/locomotion";
import "./animation/action/reach";
import "./animation/action/reach-ik";
import "./animation/action/screen";
import "./animation/action/shoot";
import "./animation/action/sit";
import "./animation/reaction/bench-idle";
import "./animation/reaction/defwin";
import "./animation/reaction/dejected";
import "./animation/reaction/foul-react";
import "./move/basic/jump";
import "./move/basic/run";
import "./move/basic/turn";

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

let player: Player | null = null;
let proto: RawModel | null = null;
let motion = "idle";
let playing = true;
let speed = 1;
let info = "読み込み中…";
let hairNo = 0;
let bonesLine = "";
let loadingHair = "";

const infoText = (): string => {
  if (!proto || !player) return "読み込み中…";
  const meshes = player.vox?.meshes.length ?? 0;
  return `ボクセル ${proto.voxelCount.toLocaleString()} / 三角形 ${proto.triangles.toLocaleString()}`
    + ` / 髪型 ${proto.hairNames.length}種 / メッシュ ${meshes}\n${bonesLine}`
    + `\n身長 ${player.height.toFixed(3)}m ｜ 直立度 ${player.upright.toFixed(2)}`;
};

// ───────────────────────── UI ─────────────────────────
const ui = document.createElement("div");
Object.assign(ui.style, {
  position: "fixed", left: "12px", top: "12px", zIndex: "10", display: "flex",
  flexDirection: "column", gap: "8px", color: "#fff", font: "600 13px system-ui, sans-serif",
  background: "rgba(12,14,20,0.72)", padding: "12px 14px", borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(6px)",
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(ui);

const row = (label: string): HTMLDivElement => {
  const d = document.createElement("div");
  Object.assign(d.style, { display: "flex", gap: "6px", alignItems: "center" } as Partial<CSSStyleDeclaration>);
  const s = document.createElement("span");
  s.textContent = label;
  Object.assign(s.style, { minWidth: "70px", opacity: "0.8", fontSize: "12px" } as Partial<CSSStyleDeclaration>);
  d.appendChild(s);
  ui.appendChild(d);
  return d;
};
const button = (parent: HTMLElement, label: string, on: () => void): HTMLButtonElement => {
  const b = document.createElement("button");
  b.textContent = label;
  Object.assign(b.style, {
    background: "rgba(40,46,60,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "8px", padding: "4px 8px", fontSize: "12px", cursor: "pointer",
  } as Partial<CSSStyleDeclaration>);
  b.onclick = on;
  parent.appendChild(b);
  return b;
};
const select = (): HTMLSelectElement => {
  const s = document.createElement("select");
  Object.assign(s.style, {
    background: "rgba(20,24,34,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "8px", padding: "4px 6px", fontSize: "12px", flex: "1", minWidth: "0",
  } as Partial<CSSStyleDeclaration>);
  return s;
};

const title = document.createElement("div");
title.textContent = "モデル確認（試合中と同じ描き方）";
Object.assign(title.style, { fontWeight: "800", fontSize: "15px", letterSpacing: "1px" });
ui.appendChild(title);

const sel = select();
for (const n of MOTION_NAMES.slice().sort()) {
  const o = document.createElement("option");
  o.value = n; o.textContent = n;
  if (n === motion) o.selected = true;
  sel.appendChild(o);
}
sel.onchange = () => {
  motion = sel.value;
  if (player) { player.clipOverride = motion; player.clipT = 0; player.clipName = ""; }
};
row("モーション").appendChild(sel);

// 直立度。試合中はボールとの距離と攻守で決まる値を、ここでは手で動かして確かめる。
const uRow = row("直立度");
const uSlider = document.createElement("input");
uSlider.type = "range"; uSlider.min = "0"; uSlider.max = "100"; uSlider.step = "1"; uSlider.value = "100";
Object.assign(uSlider.style, { flex: "1", minWidth: "0" } as Partial<CSSStyleDeclaration>);
const uLabel = document.createElement("span");
Object.assign(uLabel.style, { minWidth: "46px", fontSize: "12px", textAlign: "right" } as Partial<CSSStyleDeclaration>);
uLabel.textContent = "100%";
uSlider.oninput = () => {
  const v = Number(uSlider.value) / 100;
  uLabel.textContent = uSlider.value + "%";
  if (player) { player.uprightTarget = v; player.upright = v; }
};
uRow.appendChild(uSlider); uRow.appendChild(uLabel);

const hairSel = select();
hairSel.onchange = () => { showHair(Number(hairSel.value)); };
row("髪型").appendChild(hairSel);

const jawSel = select();
for (const [v, label] of [["normal", "標準（モデルそのまま）"], ["round", "丸顔"], ["narrow", "細あご"]] as const) {
  const o = document.createElement("option");
  o.value = v; o.textContent = label;
  jawSel.appendChild(o);
}
jawSel.onchange = () => {
  if (!proto || !player) return;
  proto.setJaw(jawSel.value as JawShape);
  // ⚠️ 選手のメッシュは見本のジオメトリを共有しているが、張り直すと別の実体に
  //    なって繋がりが切れる。作り直して拾い直す。
  player.rebuildVoxel();
  if (hairNo) showHair(hairNo);
  info = infoText();
};
row("顔（あご）").appendChild(jawSel);

const hRow = row("身長");
const hSlider = document.createElement("input");
hSlider.type = "range"; hSlider.min = "158"; hSlider.max = "203"; hSlider.step = "1";
Object.assign(hSlider.style, { flex: "1", minWidth: "0" } as Partial<CSSStyleDeclaration>);
const hLabel = document.createElement("span");
Object.assign(hLabel.style, { minWidth: "46px", fontSize: "12px", textAlign: "right" } as Partial<CSSStyleDeclaration>);
const wRow = row("体重");
const wSlider = document.createElement("input");
wSlider.type = "range"; wSlider.min = "50"; wSlider.max = "99"; wSlider.step = "1";
Object.assign(wSlider.style, { flex: "1", minWidth: "0" } as Partial<CSSStyleDeclaration>);
const wLabel = document.createElement("span");
Object.assign(wLabel.style, { minWidth: "70px", fontSize: "12px", textAlign: "right" } as Partial<CSSStyleDeclaration>);

function applyBody(): void {
  if (!player) return;
  const h = Number(hSlider.value), w = Number(wSlider.value);
  player.height = h / 100;
  player.weight = w;
  player.rebuildVoxel();
  proto = rawPrototype(scene, player.height, player.weight);
  hLabel.textContent = h + "cm";
  wLabel.textContent = w + "kg";
  if (hairNo) showHair(hairNo);
  info = infoText();
}
hSlider.oninput = applyBody;
wSlider.oninput = applyBody;
hRow.appendChild(hSlider); hRow.appendChild(hLabel);
wRow.appendChild(wSlider); wRow.appendChild(wLabel);

const ctl = row("再生");
const playBtn = button(ctl, "⏸ 停止", () => {
  playing = !playing;
  playBtn.textContent = playing ? "⏸ 停止" : "▶ 再生";
});
button(ctl, "1コマ", () => step(1 / 30));
button(ctl, "頭出し", () => { if (player) { player.clipT = 0; player.clipName = ""; } });

const spd = row("速さ");
for (const s of [0.25, 0.5, 1, 2]) button(spd, `${s}x`, () => { speed = s; });

const infoEl = document.createElement("div");
Object.assign(infoEl.style, {
  fontSize: "11px", opacity: "0.7", lineHeight: "1.6", maxWidth: "260px", whiteSpace: "pre-line",
});
ui.appendChild(infoEl);

// ───────────────────────── モデル ─────────────────────────
function showHair(no: number): void {
  if (!player) return;
  hairNo = no;
  loadingHair = no ? "髪型 " + no : "";
  player.look.hairNo = no;
  player.vox?.setHairStyle(no);
  // 髪型は選んだときに読むので、少し待ってから表示を戻す
  window.setTimeout(() => { loadingHair = ""; info = infoText(); }, 1200);
}

async function load(): Promise<void> {
  await startRawPreload();
  Player.HEADLESS = false;
  const p = new Player(scene, 0, 0, ROSTER[0][0]);
  player = p;
  p.pos.set(0, 0, 0);
  p.resetFacing();
  p.stand();
  p.clipOverride = motion;
  p.lastDt = 1 / 60;
  hSlider.value = String(Math.round(p.height * 100));
  wSlider.value = String(Math.round(p.weight));
  hLabel.textContent = Math.round(p.height * 100) + "cm";
  wLabel.textContent = Math.round(p.weight) + "kg";
  proto = rawPrototype(scene, p.height, p.weight);
  if (proto) {
    bonesLine = [...proto.perBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([b, n]) => `${b} ${n.toLocaleString()}`).join(" / ");
    hairSel.replaceChildren();
    const opts: [number, string][] = [[0, "髪なし"]];
    for (const part of proto.hairNames) {
      const n = Number(part.replace("hairstyle_", ""));
      opts.push([n, "髪型 " + part.replace("hairstyle_", "")]);
    }
    for (const [v, label] of opts) {
      const o = document.createElement("option");
      o.value = String(v); o.textContent = label;
      if (v === p.look.hairNo) o.selected = true;
      hairSel.appendChild(o);
    }
    hairNo = p.look.hairNo;
  }
  camera.setTarget(new Vector3(0, p.height * 0.55, 0));
  camera.radius = p.height * 1.6;
  info = infoText();
}

/** ゲームとまったく同じ 1 フレーム。 */
function step(dt: number): void {
  const p = player;
  if (!p) return;
  p.lastDt = dt;
  // 走る／ドリブルのクリップは歩調に同期して進むので、ここでも同じように進める
  p.stridePhase += dt * 6;
  p.sync();
}

load().catch((e: unknown) => {
  info = "★ 読み込みに失敗: " + (e instanceof Error ? e.message : String(e));
  console.error(e);
});

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05) * speed;
  if (playing) step(dt);
  const clip = motionClip(motion);
  const dur = clip ? motionDuration(clip) : 0;
  const at = player && dur ? (player.clipT % dur).toFixed(2) : "0.00";
  infoEl.textContent = (loadingHair ? `読み込み中 ${loadingHair}…\n` : "") + info
    + `\n${motion} ${at}/${dur.toFixed(2)}s`
    + `\n${Math.round(engine.getFps())} fps ｜ ドラッグで回転・ホイールで拡大`;
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
