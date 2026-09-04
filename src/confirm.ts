// モデル確認ページ。選手モデルの見た目とモーションを、**ゲームと同じ描画経路**で見る。
// 目的は「現行モデル（male_avatar 由来の3体型）」と「新モデル（player_one をボクセル化）」を
// 同じポーズ・同じモーションで並べて比べること。試合ロジックは一切動かさない。
import {
  Engine, Scene, Color3, Color4, Vector3, ArcRotateCamera,
  HemisphericLight, DirectionalLight, MeshBuilder,
} from "@babylonjs/core";
import { Player } from "./objects/player/player";
import { makeMat } from "./objects/materials";
import { setVariantOverride, type BodyVariant } from "@objcts/player/voxel/voxelBody";
import { setKitRecolor } from "./objects/player/player-voxel";
import { MOTION_NAMES, motionClip, motionDuration, applyMotion } from "@objcts/player/motion/clip";
import { ROSTER } from "./roster";
import { buildRawModel, type RawPart } from "./voxraw";
import "./objects/player/player-query";
import "./objects/player/player-state";
import "./objects/player/player-visual";
import "./objects/player/player-roster";
import "./move/basic/run";
import "./move/basic/jump";
import "./move/basic/turn";
import "./animation/basic/arms";
import "./animation/basic/torso";
import "./animation/action/locomotion";
import "./animation/action/hold";
import "./animation/action/sit";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.06, 0.08, 1);

const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.35, 4.2, new Vector3(0, 1.0, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 1.2;
camera.upperRadiusLimit = 12;
camera.wheelDeltaPercentage = 0.02;

const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.9;
hemi.groundColor = new Color3(0.35, 0.35, 0.4);
const sun = new DirectionalLight("sun", new Vector3(0.3, -0.8, 0.5), scene);
sun.intensity = 1.1;

// 足元の目安（1m グリッド）
const floor = MeshBuilder.CreateGround("floor", { width: 8, height: 8, subdivisions: 8 }, scene);
floor.material = makeMat(scene, "floorMat", { diffuse: new Color3(0.16, 0.17, 0.2) });
const grid = MeshBuilder.CreateGround("grid", { width: 8, height: 8, subdivisions: 8 }, scene);
const gridMat = makeMat(scene, "gridMat", { emissive: new Color3(0.3, 0.32, 0.38), unlit: true });
gridMat.wireframe = true;
grid.material = gridMat;
grid.position.y = 0.002;

// ---- 状態 -----------------------------------------------------------------
type ModelKey = BodyVariant;
const MODELS: { key: ModelKey; label: string }[] = [
  { key: "p1", label: "新: player_one" },
  { key: "normal", label: "現行: normal" },
  { key: "skinny", label: "現行: skinny" },
  { key: "muscle", label: "現行: muscle" },
];
// 表示モード:
//   raw  = voxel-pipeline の出力をそのまま（生の解像度・生の色）＝ボクセル化の正確さを見る
//   game = ゲーム用に焼いたもの（1.5cmへ縮小・部位分割・チームカラーで塗り替え）
let mode: "raw" | "game" = "raw";
let rawParts: RawPart[] = [];
let rawInfo = "";
let modelA: ModelKey = "p1";
let modelB: ModelKey | null = "normal";   // null = 1体だけ表示
// キットの塗り替え。切ると焼き込んだ元の色（背番号・ラインの柄）が出る。
let kitRecolor = false;
let motion = "idle";
let playing = true;
let speed = 1;
let t = 0;

let players: Player[] = [];

/** 現在の設定で選手を組み直す。variantFor の上書きを使うので1体ずつ作る。 */
function rebuild(): void {
  // Player 自体に dispose は無い。ルート配下のノード/メッシュごと畳む。
  for (const p of players) p.root.dispose(false, true);
  players = [];
  for (const r of rawParts) r.mesh.dispose();
  rawParts = [];
  if (mode === "raw") { void buildRaw(); return; }
  const defs = ROSTER[0];
  setKitRecolor(kitRecolor);
  const make = (key: ModelKey, x: number, team: number): Player => {
    setVariantOverride(key);
    const def = { ...defs[0], height: 1.95 };
    const p = new Player(scene, team, 0, def);
    p.applyUniform();
    p.pos.set(x, 0, 0);
    p.root.position.set(x, 0, 0);
    p.setNameTagVisible(false);
    setVariantOverride(null);
    return p;
  };
  if (modelB === null) {
    players = [make(modelA, 0, 0)];
  } else {
    players = [make(modelA, -0.65, 0), make(modelB, 0.65, 1)];
  }
  applyPose(0);
}

/**
 * 選んだモーションの t 秒地点のポーズを全員へ適用する。
 *
 * ⚠️ 順番が重要。`p.sync()` は内部で `syncVoxelPose()` を呼び、Player が持つ関節ノード
 * （腕・肘・腰・膝）から**リグ全体を書き直す**。先に applyMotion してから sync すると
 * そこで上書きされて動かない。sync を先に走らせ、その上へクリップを重ねる。
 * 服はスキニングなので、リグを触ったあとに `skel.prepare()` が要る。
 */
function applyPose(time: number): void {
  const clip = motionClip(motion);
  for (const p of players) {
    const vb = p.vox;
    if (!vb) continue;
    p.sync();                                   // ゲーム側の姿勢（リグを一度書き直す）
    if (!clip) continue;
    applyMotion(vb.rig, clip, time % motionDuration(clip), { rootMotion: "vertical", leanDeg: 0 });
    vb.skel.prepare();                          // リグ → スケルトン（服へ反映）
  }
}

/** パイプラインの生出力を読み込んで並べる（加工なし＝ボクセル化の正確さを見るため）。 */
async function buildRaw(): Promise<void> {
  rawInfo = "読み込み中…";
  const { parts, height } = await buildRawModel(scene, "/vox/player_one");
  rawParts = parts;
  camera.setTarget(new Vector3(0, height * 0.55, 0));
  camera.radius = height * 2.0;
  const total = parts.reduce((s, p) => s + p.voxelCount, 0);
  const lines = parts.map((p) =>
    p.name + " " + p.voxelCount.toLocaleString() + "個 @" + (p.voxelSize * 1000).toFixed(1) + "mm");
  lines.push("合計 " + total.toLocaleString() + " ボクセル");
  rawInfo = lines.join("\n");
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
  Object.assign(l.style, { opacity: "0.7", minWidth: "72px", fontSize: "12px" });
  d.appendChild(l);
  ui.appendChild(d);
  return d;
};

const select = (parent: HTMLElement, options: { value: string; label: string }[],
                cur: string, onChange: (v: string) => void): HTMLSelectElement => {
  const s = document.createElement("select");
  Object.assign(s.style, {
    background: "rgba(20,24,34,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "8px", padding: "4px 6px", fontSize: "12px", flex: "1", minWidth: "0",
  } as Partial<CSSStyleDeclaration>);
  for (const o of options) {
    const el = document.createElement("option");
    el.value = o.value; el.textContent = o.label;
    if (o.value === cur) el.selected = true;
    s.appendChild(el);
  }
  s.onchange = () => onChange(s.value);
  parent.appendChild(s);
  return s;
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
title.textContent = "モデル確認";
Object.assign(title.style, { fontWeight: "800", fontSize: "15px", letterSpacing: "1px" });
ui.appendChild(title);

select(row("表示"), [
  { value: "raw", label: "生のボクセル（パイプライン出力）" },
  { value: "game", label: "ゲーム用に焼いたもの" },
], mode, (v) => { mode = v as "raw" | "game"; rebuild(); });

const modelOpts = MODELS.map((m) => ({ value: m.key, label: m.label }));
select(row("左 / 単体"), modelOpts, modelA, (v) => { modelA = v as ModelKey; rebuild(); });
select(row("右"), [{ value: "", label: "（表示しない）" }, ...modelOpts], modelB ?? "",
  (v) => { modelB = v === "" ? null : (v as ModelKey); rebuild(); });

select(row("色"), [
  { value: "orig", label: "元の色のまま（柄が出る）" },
  { value: "kit", label: "チームカラーで塗り替え" },
], kitRecolor ? "kit" : "orig", (v) => { kitRecolor = v === "kit"; rebuild(); });

const motionOpts = MOTION_NAMES.slice().sort().map((n) => ({ value: n, label: n }));
select(row("モーション"), motionOpts, motion, (v) => { motion = v; t = 0; applyPose(0); });

const ctl = row("再生");
const playBtn = button(ctl, "⏸ 停止", () => {
  playing = !playing;
  playBtn.textContent = playing ? "⏸ 停止" : "▶ 再生";
});
button(ctl, "1コマ", () => { t += 1 / 30; applyPose(t); });
button(ctl, "頭出し", () => { t = 0; applyPose(0); });

const spd = row("速さ");
for (const s of [0.25, 0.5, 1, 2]) button(spd, `${s}x`, () => { speed = s; });

const info = document.createElement("div");
Object.assign(info.style, { fontSize: "11px", opacity: "0.65", lineHeight: "1.6", maxWidth: "230px" });
ui.appendChild(info);

// ---- ループ ---------------------------------------------------------------
rebuild();

engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (playing && mode === "game") { t += dt * speed; applyPose(t); }
  const clip = motionClip(motion);
  const dur = clip ? motionDuration(clip) : 0;
  let tris = 0;
  for (const m of scene.meshes) if (m.isEnabled() && m.isVisible) tris += m.getTotalIndices() / 3;
  info.textContent = mode === "raw"
    ? rawInfo + `\n${Math.round(engine.getFps())} fps ｜ ドラッグで回転・ホイールで拡大`
    : `${motion}  ${dur ? (t % dur).toFixed(2) : "0.00"} / ${dur.toFixed(2)}s\n`
      + `三角形 ${Math.round(tris).toLocaleString()}  メッシュ ${scene.meshes.length}\n`
      + `${Math.round(engine.getFps())} fps ｜ ドラッグで回転・ホイールで拡大`;
  info.style.whiteSpace = "pre-line";
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
