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
import { setArmStyleOverride } from "./animation/basic/arm-style";
import { setGripOverride, gripOf } from "./animation/basic/fingers";
import { rawPrototype, startRawPreload } from "./objects/player/player-raw";
import { defenseArms } from "./animation/action/defense-arms";
import { catchBall, catchLabel } from "./animation/action/catch";
// ⚠️ スティールは**試合と同じ関数・同じ定数**を使う。ここでいじった値がそのまま試合に出る。
import { PUNCH } from "./animation/action/reach";
import { STEAL, stepLunge, lungeWant } from "./ai/defense/vs-onball";
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
    + `\n身長 ${player.height.toFixed(3)}m ｜ 直立度 ${player.upright.toFixed(2)}`
    + `\n手の開き 左 ${gripOf(player).l.toFixed(2)} / 右 ${gripOf(player).r.toFixed(2)}`;
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

/** 0〜100% のスライダーを1本作る。 */
function pct(label: string, init: number, on: (v: number) => void): void {
  const r = row(label);
  const sl = document.createElement("input");
  sl.type = "range"; sl.min = "0"; sl.max = "100"; sl.step = "1"; sl.value = String(Math.round(init * 100));
  Object.assign(sl.style, { flex: "1", minWidth: "0" } as Partial<CSSStyleDeclaration>);
  const lb = document.createElement("span");
  Object.assign(lb.style, { minWidth: "46px", fontSize: "12px", textAlign: "right" } as Partial<CSSStyleDeclaration>);
  lb.textContent = sl.value + "%";
  sl.oninput = () => { lb.textContent = sl.value + "%"; on(Number(sl.value) / 100); };
  r.appendChild(sl); r.appendChild(lb);
}
// 守備度。試合中はハンドラーとの距離で決まる値を、ここでは手で動かして確かめる。
// ⚠️ 守備の腕はゲームでは poseHands が作る。確認ページはそこを通らないので、
//    同じ関数をこのページからも呼ぶ（見えるものを試合と同じにするため）。
let defense = 0, shootRisk = 0.3, driveRisk = 0.3;
pct("守備度", defense, (v) => { defense = v; if (player) { player.defenseTarget = v; player.defense = v; } });
pct("シュート気配", shootRisk, (v) => { shootRisk = v; });
pct("ドライブ気配", driveRisk, (v) => { driveRisk = v; });

// --- ボールキャッチ ---------------------------------------------------------
// ⚠️ キャッチの形はゲームでは grabPose が作る。確認ページからも同じ catchBall を
//    呼び、ボールの位置をスライダーで動かして形の変わり方を見る。
let catching = false, ballY = 2.05, ballX = 0, ballZ = 0.35;
// スティールの確認: 相手のボールを正面 stealGap m・高さ stealBallY に置いて突く。
let stealing = false, stealGap = 1.05, stealBallY = 0.95, stealWait = 0;
let stealAnchorX = 0, stealAnchorZ = 0;
let catchShown = "";
const ball = MeshBuilder.CreateSphere("ballPreview", { diameter: 0.24, segments: 12 }, scene);
ball.material = makeMat(scene, "ballMat", { diffuse: new Color3(0.85, 0.42, 0.12) });
ball.isVisible = false;
/** 最小〜最大のスライダーを1本作る。 */
function range(label: string, min: number, max: number, step: number, init: number,
               fmt: (v: number) => string, on: (v: number) => void): void {
  const r = row(label);
  const sl = document.createElement("input");
  sl.type = "range"; sl.min = String(min); sl.max = String(max); sl.step = String(step);
  sl.value = String(init);
  Object.assign(sl.style, { flex: "1", minWidth: "0" } as Partial<CSSStyleDeclaration>);
  const lb = document.createElement("span");
  Object.assign(lb.style, { minWidth: "56px", fontSize: "12px", textAlign: "right" } as Partial<CSSStyleDeclaration>);
  lb.textContent = fmt(init);
  sl.oninput = () => { lb.textContent = fmt(Number(sl.value)); on(Number(sl.value)); };
  r.appendChild(sl); r.appendChild(lb);
}
const catchRow = row("キャッチ");
const catchBtn = button(catchRow, "▶ 見る", () => {
  catching = !catching;
  catchBtn.textContent = catching ? "■ やめる" : "▶ 見る";
  ball.isVisible = catching;
  if (!catching) { catchShown = ""; if (player) player.stand(); }
});
range("ボールの高さ", 0.3, 2.6, 0.05, ballY, (v) => v.toFixed(2) + "m", (v) => { ballY = v; });
range("ボールの横ズレ", -0.9, 0.9, 0.05, ballX, (v) => (v >= 0 ? "右 " : "左 ") + Math.abs(v).toFixed(2) + "m",
  (v) => { ballX = v; });
// 奥行き。負にすると体の後ろ（頭の上から後ろへ回したリバウンドなどを見るため）。
range("ボールの奥行き", -0.6, 0.9, 0.05, ballZ, (v) => (v >= 0 ? "前 " : "後 ") + Math.abs(v).toFixed(2) + "m",
  (v) => { ballZ = v; });

// ───────── スティールの突き（reach.ts digReach ＋ vs-onball stepLunge）─────────
// ⚠️ 試合と同じ経路: beginAction("steal") の段階 → stepLunge で踏み込み →
//    digReach でポーズ。スライダーは試合で使う定数そのものを書き換える。
const stealRow = row("スティール");
const stealBtn = button(stealRow, "▶ 見る", () => {
  stealing = !stealing;
  stealBtn.textContent = stealing ? "■ やめる" : "▶ 見る";
  ball.isVisible = stealing || catching;
  if (player) {
    // 踏み込みで動かした位置と、進行中の段階を戻してから始める/やめる。
    player.lungeD = 0;
    player.pos.set(0, 0, 0);
    player.actKind = ""; player.actPhase = ""; player.actT = 0; player.actFired = false;
    if (!stealing) player.stand();
  }
  stealWait = 0;
});
range("相手との距離", 0.6, 2.0, 0.05, stealGap, (v) => v.toFixed(2) + "m", (v) => { stealGap = v; });
range("相手のボールの高さ", 0.3, 1.6, 0.05, stealBallY, (v) => v.toFixed(2) + "m", (v) => { stealBallY = v; });
range("踏み込む距離", 0, 0.8, 0.02, STEAL.lungeIn, (v) => v.toFixed(2) + "m", (v) => { STEAL.lungeIn = v; });
range("溜めの長さ", 0.04, 0.40, 0.01, STEAL.windup, (v) => v.toFixed(2) + "秒", (v) => { STEAL.windup = v; });
range("溜めに使う割合", 0.1, 0.9, 0.02, PUNCH.cockFrac, (v) => (v * 100).toFixed(0) + "%", (v) => { PUNCH.cockFrac = v; });
range("逆手の振り（溜め）", -1.4, 0.8, 0.05, PUNCH.backCock, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.backCock = v; });
range("逆手の振り（突き）", -1.4, 0.8, 0.05, PUNCH.backThrust, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.backThrust = v; });
range("逆手の肘", 0, 2.0, 0.05, PUNCH.backBend, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.backBend = v; });
range("引き手の位置", -0.1, 0.4, 0.02, PUNCH.cockIn, (v) => v.toFixed(2) + "m", (v) => { PUNCH.cockIn = v; });
range("引き手の高さ", -0.3, 0.4, 0.02, PUNCH.cockRise, (v) => (v === 0 ? "水平" : v.toFixed(2) + "m"), (v) => { PUNCH.cockRise = v; });
range("沈み込み", 0, 2, 0.05, PUNCH.sink, (v) => (v === 0 ? "なし" : v.toFixed(2) + "倍"), (v) => { PUNCH.sink = v; });
range("肩を出す回転", 0, 1.0, 0.02, PUNCH.twist, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.twist = v; });
range("溜めで肩を引く", 0, 0.8, 0.02, PUNCH.cockShoulder, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.cockShoulder = v; });
range("溜めで肘を畳む", 0, 2.0, 0.05, PUNCH.cockElbow, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.cockElbow = v; });
range("踏み込みの前傾", 0, 0.4, 0.01, PUNCH.lungeLean, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { PUNCH.lungeLean = v; });
range("胴回転の符号", -1, 1, 2, PUNCH.sign, (v) => (v < 0 ? "−1（実測でリーチ最大）" : "+1"), (v) => { PUNCH.sign = v || -1; });

// ───────── 走る腕振りの癖（arm-style.ts）と手の握り（fingers.ts）─────────
// ⚠️ ゲームでは選手ごとに名前から決まる。ここは全員へ同じ値を被せて幅を確かめるためのもの。
let swing = 1, pull = 0.23, inward = 0.18;
const pushStyle = (): void =>
  setArmStyleOverride({ swing, pullL: pull, pullR: pull, inL: inward, inR: inward });
range("振り幅（腕）", 0.6, 1.5, 0.02, swing, (v) => v.toFixed(2) + "倍",
  (v) => { swing = v; pushStyle(); });
range("肘の引き", 0, 0.7, 0.01, pull, (v) => (v * 180 / Math.PI).toFixed(0) + "°",
  (v) => { pull = v; pushStyle(); });
range("体への寄り", 0, 0.4, 0.01, inward, (v) => (v * 180 / Math.PI).toFixed(0) + "°",
  (v) => { inward = v; pushStyle(); });
pushStyle();
// 手の握り。マイナス側で「自動（胴からの距離で決まる）」に戻す。
range("手の握り", -1, 1, 0.05, -1,
  (v) => (v < 0 ? "自動" : v === 0 ? "グー" : v.toFixed(2)),
  (v) => { setGripOverride(v < 0 ? null : v); });
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
  // ボールキャッチ（ゲームでは grabPose が呼ぶのと同じもの）
  if (catching && !stealing) {
    const th = p.root.rotation.y;
    const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
    const rx = fz, rz = -fx;                         // 体の右
    ball.position.set(p.pos.x + fx * ballZ + rx * ballX, p.pos.y + ballY,
      p.pos.z + fz * ballZ + rz * ballX);
    catchShown = catchLabel(p, catchBall(p, ball.position));
  }
  // スティールの突き。⚠️ 試合とまったく同じ手順:
  //   tickAction で段階を進める → stepLunge で体ごと踏み込む → digReach でポーズ。
  if (stealing) {
    // ボールは床に固定して置く（踏み込みで選手が前へ出るのが見えるように）。
    if (!p.actPhase && stealWait <= 0) {
      const th = p.root.rotation.y;
      const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
      stealAnchorX = fx * stealGap;
      stealAnchorZ = fz * stealGap;
    }
    ball.position.set(stealAnchorX, stealBallY, stealAnchorZ);
    p.tickAction(dt);
    if (!p.actPhase) {
      stealWait -= dt;
      if (stealWait <= 0) { p.beginAction("steal", STEAL.windup, STEAL.active, STEAL.cooldown); stealWait = 0.6; }
      else p.stand();
    }
    // ⚠️ 試合では毎フレーム呼ばれ、段階が無い時は踏み込みを 0 へ戻す。ここも同じにする。
    stepLunge(p, stealAnchorX, stealAnchorZ, 9);   // 確認ページには相手の体が無いので余地は十分
    if (p.actPhase) p.digReach(new Vector3(stealAnchorX, stealBallY, stealAnchorZ));
  }
  // 守備の腕（ゲームでは poseHands が呼ぶのと同じもの）。相手は正面 1.2m に居る想定。
  if (!catching && !stealing && defense > 0.02) {
    p.defenseTarget = defense;
    const th = p.root.rotation.y;
    const fx = Math.sin(th) * -p.numberSide, fz = Math.cos(th) * -p.numberSide;
    defenseArms(p, new Vector3(p.pos.x + fx * 1.2, p.pos.y + 1.15, p.pos.z + fz * 1.2),
      shootRisk, driveRisk, 0);
  }
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
    + (catching ? `\nキャッチ: ${catchShown}` : "")
    + (stealing && player
      ? `\nスティール: ${player.actPhase || "待ち"} ｜ 踏み込み ${player.lungeD.toFixed(2)}m`
        + ` / 目標 ${lungeWant(player).toFixed(2)}m`
        + `\n  踏み込み ${STEAL.lungeIn.toFixed(2)}m / 溜め ${STEAL.windup.toFixed(2)}s / 引き割合 ${(PUNCH.cockFrac * 100).toFixed(0)}%`
        + `\n  肩 ${PUNCH.twist.toFixed(2)} 引き ${PUNCH.cockShoulder.toFixed(2)} 肘 ${PUNCH.cockElbow.toFixed(2)} 前傾 ${PUNCH.lungeLean.toFixed(2)} 符号 ${PUNCH.sign}`
      : "")
    + `\n${Math.round(engine.getFps())} fps ｜ ドラッグで回転・ホイールで拡大`;
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
