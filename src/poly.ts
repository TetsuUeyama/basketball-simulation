// ポリゴン（デフォルメ）路線の検証ページ。
// ⚠️ これは「ボクセルをやめてポリゴンにできるか」を**実物で確かめる**ための場所。
//    確かめたいのは3つだけ:
//      1. 体型（身長・太さ）がボーンで変えられるか
//      2. 髪を差し替えられるか・そのコストはいくらか
//      3. 目と口の位置と角度を変えられるか（口は元モデルにジオメトリが無い）
//    素材は Blender から書き出した public/poly/*.glb（元は player-one の FBX と
//    Man Hair Collection）。ゲーム本体のコードは通していない。
import {
  Engine, Scene, Color3, Color4, Vector3, ArcRotateCamera, HemisphericLight,
  DirectionalLight, MeshBuilder, StandardMaterial, Texture, DynamicTexture,
  SceneLoader, TransformNode, Quaternion, Matrix,
  type AbstractMesh, type Skeleton, type Bone, type Mesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.06, 0.08, 1);

const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.35, 3.2, new Vector3(0, 1.0, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 0.4;
camera.upperRadiusLimit = 12;
camera.wheelDeltaPercentage = 0.02;

new HemisphericLight("hemi", new Vector3(0, 1, 0), scene).intensity = 0.85;
const sun = new DirectionalLight("sun", new Vector3(0.3, -0.8, 0.5), scene);
sun.intensity = 1.1;

const floor = MeshBuilder.CreateGround("floor", { width: 6, height: 6 }, scene);
const fm = new StandardMaterial("fm", scene);
fm.diffuseColor = new Color3(0.14, 0.15, 0.18);
fm.specularColor = new Color3(0, 0, 0);
floor.material = fm;

// ───────────────────────── UI（confirm.ts と同じ作り） ─────────────────────────
const ui = document.createElement("div");
Object.assign(ui.style, {
  position: "fixed", left: "12px", top: "12px", zIndex: "10", display: "flex",
  flexDirection: "column", gap: "8px", color: "#fff", font: "600 13px system-ui, sans-serif",
  background: "rgba(12,14,20,0.72)", padding: "12px 14px", borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(6px)",
  maxHeight: "calc(100vh - 24px)", overflowY: "auto", overflowX: "hidden",
  width: "320px", boxSizing: "border-box",
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(ui);

let box: HTMLElement = ui;
const section = (label: string, open: boolean): void => {
  const d = document.createElement("details");
  d.open = open;
  Object.assign(d.style, { border: "1px solid rgba(255,255,255,0.14)", borderRadius: "8px",
    padding: "4px 6px" } as Partial<CSSStyleDeclaration>);
  const sm = document.createElement("summary");
  sm.textContent = label;
  Object.assign(sm.style, { cursor: "pointer", fontSize: "12px", opacity: "0.85",
    padding: "2px 0" } as Partial<CSSStyleDeclaration>);
  d.appendChild(sm);
  const inner = document.createElement("div");
  Object.assign(inner.style, { display: "flex", flexDirection: "column", gap: "6px",
    marginTop: "6px" } as Partial<CSSStyleDeclaration>);
  d.appendChild(inner);
  ui.appendChild(d);
  box = inner;
};
const row = (label: string): HTMLDivElement => {
  const d = document.createElement("div");
  Object.assign(d.style, { display: "flex", gap: "6px", alignItems: "center" } as Partial<CSSStyleDeclaration>);
  const s = document.createElement("span");
  s.textContent = label;
  Object.assign(s.style, { minWidth: "82px", opacity: "0.8", fontSize: "12px" } as Partial<CSSStyleDeclaration>);
  d.appendChild(s);
  box.appendChild(d);
  return d;
};
const range = (label: string, min: number, max: number, step: number, init: number,
               fmt: (v: number) => string, on: (v: number) => void): HTMLInputElement => {
  const r = row(label);
  const sl = document.createElement("input");
  sl.type = "range"; sl.min = String(min); sl.max = String(max); sl.step = String(step);
  sl.value = String(init);
  Object.assign(sl.style, { flex: "1", minWidth: "0" } as Partial<CSSStyleDeclaration>);
  const lb = document.createElement("span");
  Object.assign(lb.style, { minWidth: "58px", fontSize: "12px", textAlign: "right" } as Partial<CSSStyleDeclaration>);
  lb.textContent = fmt(init);
  sl.oninput = () => { lb.textContent = fmt(Number(sl.value)); on(Number(sl.value)); };
  r.appendChild(sl); r.appendChild(lb);
  return sl;
};
const select = (label: string): HTMLSelectElement => {
  const s = document.createElement("select");
  Object.assign(s.style, {
    background: "rgba(20,24,34,0.95)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "8px", padding: "4px 6px", fontSize: "12px", flex: "1", minWidth: "0",
  } as Partial<CSSStyleDeclaration>);
  row(label).appendChild(s);
  return s;
};
const title = document.createElement("div");
title.textContent = "ポリゴン検証";
Object.assign(title.style, { fontSize: "14px", marginBottom: "2px" } as Partial<CSSStyleDeclaration>);
ui.appendChild(title);
const infoEl = document.createElement("div");
Object.assign(infoEl.style, { fontSize: "11px", opacity: "0.85", whiteSpace: "pre-line",
  lineHeight: "1.5", marginTop: "4px" } as Partial<CSSStyleDeclaration>);
// ⚠️ 最初から貼っておく。buildUI の中で貼ると、読み込みに失敗したとき
//    エラーが画面に出ないまま「何も起きない」ように見える。
ui.appendChild(infoEl);
/** どの版が動いているかの目印。キャッシュかコードかを一発で見分けるため。 */
const BUILD = "v21";

// ───────────────────────── 読み込み ─────────────────────────
let skel: Skeleton | null = null;
let bodyMeshes: AbstractMesh[] = [];
let eyesMesh: AbstractMesh | null = null;
let eyeParts: AbstractMesh[] = [];
let info = "読み込み中…";

/** ボーンを名前で引く（Mixamo 命名。接頭辞が付く書き出しもあるので後方一致で拾う）。 */
const bone = (name: string): Bone | null =>
  skel?.bones.find((b) => b.name === name || b.name.endsWith(":" + name) || b.name.endsWith("_" + name)) ?? null;

/** 素のスケールを覚えておく（毎回そこから掛け直す。掛け算で溜まらないように）。 */
const restScale = new Map<string, Vector3>();
/** リンクされた TransformNode を持つボーンの数（診断用）。 */
let linkedBones = 0;
/**
 * ボーンのスケールを設定する。
 * ⚠️ glTF ローダーはボーンを **TransformNode にリンク**する。リンクがある間、
 *    ボーンのローカル行列は毎フレームそのノードから作り直されるので、
 *    bone.setScale() は**書いた次のフレームで消える**（スライダーを動かしても
 *    何も起きない、の原因）。リンクがあるときはノード側を触ること。
 */
const setBone = (name: string, x: number, y: number, z: number): void => {
  const b = bone(name);
  if (!b) return;
  const tn = b.getTransformNode();
  if (!restScale.has(name)) restScale.set(name, (tn ? tn.scaling : b.getScale()).clone());
  const r = restScale.get(name)!;
  const next = new Vector3(r.x * x, r.y * y, r.z * z);
  if (tn) { tn.scaling.copyFrom(next); tn.computeWorldMatrix(true); }
  else b.setScale(next);
};

/** ボーンのワールド Y。⚠️ ボーンを動かした結果はここに出る。 */
function boneY(name: string): number {
  const b = bone(name);
  if (!b || !bodyMeshes[0]) return 0;
  return b.getAbsolutePosition(bodyMeshes[0] as TransformNode).y;
}
// 素の姿勢で測った「頭のボーン→頭頂」と「足のボーン→足裏」の差。
let crownGap = 0, soleGap = 0;
/**
 * 今の見た目の身長(m)。
 * ⚠️ refreshBoundingInfo({applySkeleton:true}) では**測れない**。実測で、脚のボーンを
 *    2倍にして足のボーンが 0.111m → -0.734m へ動いても、境界箱は 1 mm も変わらなかった
 *    （スキン適用の境界箱がボーン行列の変更を拾わない）。ボーンの位置から出すこと。
 */
function measuredHeight(): number {
  const top = boneY("Head") + crownGap * headSize;
  const foot = Math.min(boneY("LeftFoot"), boneY("RightFoot")) - soleGap;
  return Math.max(0, top - foot);
}
function counts(): { mesh: number; vert: number; tri: number } {
  let mesh = 0, vert = 0, tri = 0;
  for (const m of scene.meshes) {
    if (m === floor || !m.isEnabled() || m.getTotalVertices() === 0) continue;
    mesh++; vert += m.getTotalVertices(); tri += m.getTotalIndices() / 3;
  }
  return { mesh, vert, tri: Math.round(tri) };
}

// ───────────────────────── 体型（ボーン） ─────────────────────────
// ⚠️ Blender での実測どおり、入れ子のボーン(Spine→Spine1→Spine2)はスケールが
//    掛け算になる。ここでは**背骨は1段だけ**(Spine)に掛けて暴れないようにしている。
const LEG = ["LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg"];
let legLen = 1, spineLen = 1, thick = 1, headSize = 1;
function applyBody(): void {
  // 脚は長さと太さを同時に、背骨は1段だけ、腰は太さだけ。
  for (const n of LEG) setBone(n, thick, legLen, thick);
  setBone("Spine", thick, spineLen, thick);
  setBone("Hips", thick, 1, thick);
  setBone("Head", headSize, headSize, headSize);
  // ⚠️ ここを呼ばないと**見た目が1ミリも変わらない**。
  //    ボーンの位置や身長の数字は更新されるのに、シェーダへ送る行列だけ古いまま。
//    skeleton.js の prepare() は「今フレーム既に呼ばれていたら何もしない」うえ、
  //    リンクノードからボーンへ写す処理の後に `if (!this._isDirty) return;` があるため。
  //    実測(probe-poly4、getTransformMatrices の最大差):
  //      ノードへ書くだけ 0.0000 / + bone.markAsDirty() 0.0000 / + prepare(true) 46.98
  skel?.prepare(true);
  info = infoText();
}

// ───────────────────────── 髪 ─────────────────────────
const HAIRS = ["Man_Hair_001", "Man_Hair_010", "Man_Hair_030", "Man_Hair_050",
               "Man_Hair_070", "Man_Hair_090", "Man_Hair_110", "Man_Hair_130"];
const hairCache = new Map<string, AbstractMesh[]>();   // ファイル → 読み込んだ全メッシュ
let hairNode: TransformNode | null = null;   // 骨のスケールを打ち消した後の入れ物
let headNode: TransformNode | null = null;
let boneScale = 1;
let hairMesh: AbstractMesh | null = null;
let hairFile = "hair_low.glb", hairPick = HAIRS[0];
// 標準の位置。⚠️ 頭ボーンは後頭部寄りにあるので、そのままだと髪が下がって前へずれる。
// ⚠️ 上下の既定は読み込み時に「頭ボーン→頭頂」の実測値(crownGap)を入れる。
//    基準点が頭頂なので、そこへ置けば髪が頭に乗る。
let hairScale = 1, hairUp = 0.10, hairFwd = 0.03;
let hairUpSlider: HTMLInputElement | null = null;
const HEAD_W = 0.19;   // 頭の幅の目安(m)。付けた後の実寸をここへ合わせる
let hairFit = 1;

async function loadHairFile(file: string): Promise<AbstractMesh[]> {
  const got = hairCache.get(file);
  if (got) return got;
  const r = await SceneLoader.ImportMeshAsync("", "/poly/", file, scene);
  killedAnims += killAnimations(r.animationGroups);   // 髪側にも入っていれば止める
  for (const m of r.meshes) m.setEnabled(false);
  hairCache.set(file, r.meshes);
  return r.meshes;
}
async function showHair(): Promise<void> {
  if (hairMesh) { hairMesh.setEnabled(false); hairMesh = null; }
  if (hairPick === "なし") { info = infoText(); return; }
  const all = await loadHairFile(hairFile);
  // ⚠️ ここも "_primitive0" が付く。前方一致で拾う。
  const m = all.find((x) => x.name === hairPick || x.name.startsWith(hairPick + "_primitive"));
  if (!m) {
    info = "髪が見つからない: " + hairPick + " / 候補 " + all.map((x) => x.name).join(", ");
    return;
  }
  // 頭ボーンへ付ける。⚠️ 髪側にアーマチュアが無いので、ボーンへの親子付けで運ぶ。
  const head = bone("Head");
  if (head && hairNode) {
    m.parent = hairNode;
    m.position.set(0, hairUp, hairFwd);
    m.scaling.setAll(hairScale);
    m.rotationQuaternion = Quaternion.Identity();
  }
  m.setEnabled(true);
  hairMesh = m;
  // ⚠️ 基準点は書き出し時に「上から20%の帯の中心(x,y)・上端(z)」で**全髪型そろえて**
  //    ある（tools_export_hair.py）。倍率も共通の1つを焼き込み済みなので、
  //    ここで髪型ごとに measure して合わせ直してはいけない（大きさの差が消える）。
  //    実測: 8種すべて上端が +0.0000m、幅は 0.171〜0.250m（髪型本来の差）。
  hairFit = 1;
  placeHair();
  info = infoText();
}
function placeHair(): void {
  if (!hairMesh) return;
  hairMesh.position.set(0, hairUp, hairFwd);
  hairMesh.scaling.setAll(hairScale * hairFit);
}

// ───────────────────────── 目と口 ─────────────────────────
// 目は元モデルのジオメトリ（別オブジェクトへ切り出し済み・原点は目の重心）。
// 口は元モデルに**ジオメトリが無い**（顔テクスチャに描かれている）ので、
// ここでは「口だけ板を貼る」案を実演する。現行のボクセル版 faceMarks と同じ考え方。
let eyeRest: Vector3 | null = null;
let eyeCenter = Vector3.Zero();   // 焼き込んだ時の目の中心(ワールド)。回転の中心
let eyeBase = Vector3.Zero();     // 焼き込み後に素の見た目へ戻すための下駄
const _rm = Matrix.Identity();
let eyeX = 0, eyeY = 0, eyeZ = 0, eyePitch = 0, eyeYaw = 0;
function applyEyes(): void {
  if (!eyeRest || !headNode) return;
  // 目は白目とまつげでメッシュが分かれている。まとめて動かす。
  // 頭ボーンのワールド位置を基準にするので、体型を変えても顔に付いてくる。
  headNode.computeWorldMatrix(true);
  const hp = headNode.getAbsolutePosition();
  // 焼き込んだ時の頭の位置からの差分 ＋ スライダーぶん。
  // ⚠️ 回転は**目の中心まわり**にする。頂点はワールド座標が焼き込まれているので、
  //    素直に回すと原点まわりに振り回される。位置へ (c - R·c) を足して中心を移す。
  const rot = Quaternion.RotationYawPitchRoll(eyeYaw, eyePitch, 0);
  Matrix.FromQuaternionToRef(rot, _rm);
  const rc = Vector3.TransformCoordinates(eyeCenter, _rm);
  const dx = eyeBase.x + hp.x - eyeRest.x + eyeX + eyeCenter.x - rc.x;
  const dy = eyeBase.y + hp.y - eyeRest.y + eyeY + eyeCenter.y - rc.y;
  const dz = eyeBase.z + hp.z - eyeRest.z + eyeZ + eyeCenter.z - rc.z;
  for (const m of eyeParts) {
    m.position.set(dx, dy, dz);
    m.rotationQuaternion = rot;
  }
}
let mouth: Mesh | null = null;
let mouthTex: DynamicTexture | null = null;
// 位置は頭の補正ノードから見た相対（メートル）。形は下の4つで決まる。
let mouthY = 0.08, mouthZ = 0.085, mouthPitch = 0, mouthRoll = 0;
let mouthW = 0.050, mouthH = 0.022, mouthCurve = 0, mouthOpen = 0.35;
// ⚠️ 既定は**出さない**。のっぺらぼうの顔に暗い楕円を乗せると「口が開いている」ように
//    しか見えない（実際にそう報告された）。見たい時だけ出す。
let mouthOn = false;
const MT_W = 192, MT_H = 96;
/**
 * 口の形を描き直す。⚠️ 元モデルに口のジオメトリは無い（顔テクスチャに描かれている）
 *    ので、板に描いて顔へ貼る。現行のボクセル版 faceMarks と同じ考え方。
 */
function drawMouth(): void {
  if (!mouthTex) return;
  const cx = mouthTex.getContext();
  cx.clearRect(0, 0, MT_W, MT_H);
  const x0 = MT_W * 0.06, x1 = MT_W * 0.94, mid = MT_W / 2;
  const yc = MT_H / 2;
  const corner = yc - mouthCurve * MT_H * 0.30;   // 口角の上下（＋で笑い）
  const half = mouthOpen * MT_H * 0.42;           // 開き
  cx.fillStyle = "#7a3c32";
  cx.beginPath();
  cx.moveTo(x0, corner);
  cx.quadraticCurveTo(mid, yc - half, x1, corner);   // 上唇の内側
  cx.quadraticCurveTo(mid, yc + half, x0, corner);   // 下唇の内側
  cx.closePath();
  cx.fill();
  mouthTex.update();
}
function makeMouth(): void {
  mouth = MeshBuilder.CreatePlane("mouth", { width: 1, height: 1 }, scene);
  mouthTex = new DynamicTexture("mouthTex", { width: MT_W, height: MT_H }, scene, false);
  mouthTex.hasAlpha = true;
  const mm = new StandardMaterial("mouthMat", scene);
  mm.diffuseTexture = mouthTex;
  mm.opacityTexture = mouthTex;
  mm.specularColor = new Color3(0, 0, 0);
  mm.emissiveColor = new Color3(0.25, 0.25, 0.25);
  mm.backFaceCulling = false;
  mouth.material = mm;
  drawMouth();
  placeMouth();
}
function placeMouth(): void {
  if (!mouth) return;
  mouth.setEnabled(mouthOn);
  mouth.position.set(0, mouthY, mouthZ);
  mouth.scaling.set(mouthW, mouthH, 1);
  mouth.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.PI, mouthPitch, mouthRoll);
}
function infoText(): string {
  const c = counts();
  const h = measuredHeight();
  return `身長 ${(h * 100).toFixed(1)}cm\n`
    + `ボーン ${skel ? skel.bones.length : 0} 本（ノード連動 ${linkedBones} 本 / 止めたアニメ ${killedAnims} 個）\n`
    + `[${BUILD}] 脚スライダー ${legLen.toFixed(2)} → LeftUpLeg ノードの縦 ${(bone("LeftUpLeg")?.getTransformNode()?.scaling.y ?? -1).toFixed(3)}\n`
    + `メッシュ ${c.mesh} / 頂点 ${c.vert.toLocaleString()} / 三角形 ${c.tri.toLocaleString()}\n`
    + `比較: 現行ボクセル(18.75mm) 1人 = 頂点 85,728 / 三角形 40,896\n`
    + `ドラッグで回転・ホイールで拡大`;
}

// ───────────────────────── 組み立て ─────────────────────────
/**
 * 読み込んだ GLB のアニメーションを止めて捨てる。
 * ⚠️ **これをしないと体型の操作が効かない。** glTF ローダーは既定で最初の
 *    アニメーションを自動再生する（AnimationStartMode = FIRST）。このモデルには
 *    52本すべてのボーンの translation/rotation/**scale** を持つクリップが入っており、
 *    こちらが書いたスケールを毎フレーム元へ戻してしまう。
 *    実測(probe-poly7): 止めないと 10 フレームでノードの縦が 1.500 → 1.000 に戻り、
 *    行列の差も 19.574 → 0.000 になる。止めれば保たれる。
 *    ⚠️ 数フレームしか回さない検証では**再現しない**。描画ループと同じだけ回すこと。
 */
function killAnimations(groups: { stop(): void; dispose(): void }[]): number {
  for (const g of groups) { g.stop(); g.dispose(); }
  return groups.length;
}
let killedAnims = 0;

/** 今読んでいる素体。切り替えたら全部作り直す。 */
let bodyFile = "player_flat.glb";
let loadedRoots: AbstractMesh[] = [];

async function load(): Promise<void> {
  const r = await SceneLoader.ImportMeshAsync("", "/poly/", bodyFile, scene);
  loadedRoots = r.meshes;
  killedAnims = killAnimations(r.animationGroups);
  scene.stopAllAnimations();
  skel = r.skeletons[0] ?? null;
  bodyMeshes = r.meshes.filter((m) => m.getTotalVertices() > 0);
  // ⚠️ glTF ローダーはメッシュをマテリアルごとに分け、"eyes_primitive0" のように
  //    名前へ接尾辞を付ける。完全一致では引けない（実測でここが null だった）。
  eyeParts = bodyMeshes.filter((m) => m.name === "eyes" || m.name.startsWith("eyes_primitive"));
  eyesMesh = eyeParts[0] ?? null;
  bodyMeshes = bodyMeshes.filter((m) => !eyeParts.includes(m));   // 身長の計測から外す
  // ⚠️ スキン中のメッシュは**自分の位置を変えても動かない**（頂点は骨の行列だけで
  //    決まる。実測で +0.05m 動かしてもワールドでは 0.000m だった）。
  //    今の見た目を頂点へ焼き込み(applySkeleton)、スケルトンを外してから
  //    頭の補正ノードの子にする。以降はふつうのメッシュとして動かせる。
  if (eyeParts.length && skel && hairNode) {
    for (const m of eyeParts) {
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo({ applySkeleton: true });
    }
    const cy = eyeParts[0].getBoundingInfo().boundingBox.centerWorld.clone();
    for (const m of eyeParts) {
      (m as Mesh).applySkeleton(skel);   // 今の見た目を頂点へ焼き込む
      m.skeleton = null;
      // ⚠️ 焼き込んだ頂点は**ワールド座標**なので、親に付けてはいけない
      //    （骨の 1/39.4 スケールが掛かって y が -11m まで飛んだ）。
      //    親なしのまま、毎フレーム頭ボーンの位置へ合わせる。
      m.parent = null;
      m.position.setAll(0);
      m.rotationQuaternion = Quaternion.Identity();
      m.scaling.setAll(1);
    }
    // ⚠️ 焼き込んだ頂点がどの空間に入るかは推測しない。**一度測って差分で合わせる**。
    //    （素直に頭ボーンの位置を足すと二重になって y が 1.69→3.91、
    //     setPivotPoint を使うと 0.53m ずれた。どちらも実測で外れた）
    eyeParts[0].computeWorldMatrix(true);
    eyeParts[0].refreshBoundingInfo({ applySkeleton: false });
    const got = eyeParts[0].getBoundingInfo().boundingBox.centerWorld;
    eyeBase = new Vector3(cy.x - got.x, cy.y - got.y, cy.z - got.z);
    // ⚠️ 焼き込んだ頂点は**素の見た目の位置そのもの**なので、位置は 0 が正解。
    //    ここへ頭ボーンの絶対位置を足すと二重になる（実測で y が 1.69 → 3.91 になった）。
    //    覚えるのは「焼き込んだ時の頭ボーンの位置」。以後はそこからの**差分**で動かす。
    headNode?.computeWorldMatrix(true);
    eyeRest = headNode ? headNode.getAbsolutePosition().clone() : Vector3.Zero();
    // ⚠️ setPivotPoint は使わない（位置が 0.53m ずれた）。回転の中心は下の式で明示する。
    eyeCenter = cy.clone();
    applyEyes();
  }
  // 髪を運ぶ入れ物を頭ボーンへ付ける（髪そのものはここの子にする）
  // ⚠️ 髪も口も目も**頭ボーンへ**付ける。付けないと体型を変えた時に顔から離れる。
  // ⚠️ さらに、この骨の行列には **1/39.4 のスケール**が入っている
  //    （0.0254 = インチ→メートル。FBX 由来のリグの単位がそのまま残っている）。
    //  そのまま子にすると、付けたものが 39.4 分の1に縮み、位置の指定も 39.4 分の1に
    //  なる（実測: 幅 0.190m の髪が 0.0048m に、+0.05m の移動が +0.001m に）。
    //  打ち消す補正ノードを1枚挟んで、以降はメートルで書けるようにする。
  const head = bone("Head");
  if (head && bodyMeshes[0]) {
    headNode = new TransformNode("headNode", scene);
    headNode.attachToBone(head, bodyMeshes[0]);
    headNode.computeWorldMatrix(true);
    const sc = new Vector3();
    const rq = new Quaternion();
    const tp = new Vector3();
    // ⚠️ decompose は3つとも渡すこと。scale だけ渡すと y,z が埋まらず、
    //    平均を取ると 1/3 の値（実測 0.00847）になって補正が3倍ずれる。
    headNode.getWorldMatrix().decompose(sc, rq, tp);
    boneScale = sc.x || 1;
    hairNode = new TransformNode("hairFix", scene);
    hairNode.parent = headNode;
    hairNode.scaling.setAll(1 / boneScale);
  }
  makeMouth();
  if (mouth && hairNode) mouth.parent = hairNode;
  placeMouth();
  buildUI();
  info = infoText();
  linkedBones = skel ? skel.bones.filter((b) => !!b.getTransformNode()).length : 0;
  // 素の姿勢のうちに、頭のボーンから上と足のボーンから下の分を測っておく。
  {
    let lo = Infinity, hi = -Infinity;
    for (const m of bodyMeshes) {
      m.computeWorldMatrix(true);
      // ⚠️ applySkeleton:true でないと箱が潰れる（実測 -0.005〜0.004m）。
      //    ただし**素の姿勢でしか使えない**。ボーンを動かした後は更新されないので、
      //    ここで一度だけ測って、以後はボーンの位置から身長を出す。
      m.refreshBoundingInfo({ applySkeleton: true });
      const bb = m.getBoundingInfo().boundingBox;
      lo = Math.min(lo, bb.minimumWorld.y); hi = Math.max(hi, bb.maximumWorld.y);
    }
    crownGap = hi - boneY("Head");
    hairUp = crownGap;   // 髪の基準点(頭頂)を頭のてっぺんへ
    soleGap = Math.min(boneY("LeftFoot"), boneY("RightFoot")) - lo;
  }
  const names = skel ? skel.bones.map((b) => b.name) : [];
  console.log("ボーン", names.length, "リンク", linkedBones, names.slice(0, 60));
  console.log("メッシュ", bodyMeshes.map((m) => m.name));
  applyBody();
}

function buildUI(): void {
  const bf = select("素体");
  for (const [v, l] of [["player_flat.glb", "のっぺらぼう 76,017三角形"],
                        ["player_flat_low.glb", "のっぺらぼう＋間引き 26,600三角形"],
                        ["player.glb", "元モデル（実写調）89,368三角形"]] as const) {
    const o = document.createElement("option"); o.value = v; o.textContent = l; bf.appendChild(o);
  }
  bf.value = bodyFile;
  bf.onchange = () => { bodyFile = bf.value; void reload(); };

  section("体型（ボーンで変える）", true);
  range("脚の長さ", 0.8, 1.3, 0.01, legLen, (v) => v.toFixed(2) + "倍", (v) => { legLen = v; applyBody(); });
  range("胴の長さ", 0.8, 1.3, 0.01, spineLen, (v) => v.toFixed(2) + "倍", (v) => { spineLen = v; applyBody(); });
  range("太さ", 0.7, 1.6, 0.01, thick, (v) => v.toFixed(2) + "倍", (v) => { thick = v; applyBody(); });
  range("頭の大きさ", 0.7, 1.3, 0.01, headSize, (v) => v.toFixed(2) + "倍", (v) => { headSize = v; applyBody(); });
  box = ui;

  section("髪（差し替え）", true);
  const hf = select("データ");
  for (const [v, l] of [["hair_low.glb", "間引き25%（1つ 約6,068三角形）"],
                        ["hair.glb", "生データ（1つ 約24,274三角形）"]] as const) {
    const o = document.createElement("option"); o.value = v; o.textContent = l; hf.appendChild(o);
  }
  hf.onchange = () => { hairFile = hf.value; void showHair(); };
  const hs = select("髪型");
  for (const n of ["なし", ...HAIRS]) {
    const o = document.createElement("option"); o.value = n; o.textContent = n; hs.appendChild(o);
  }
  hs.value = HAIRS[0];
  hs.onchange = () => { hairPick = hs.value; void showHair(); };
  range("大きさ", 0.4, 2.0, 0.01, hairScale, (v) => v.toFixed(2) + "倍", (v) => { hairScale = v; placeHair(); });
  hairUpSlider = range("上下", -0.05, 0.30, 0.005, hairUp, (v) => (v * 100).toFixed(1) + "cm", (v) => { hairUp = v; placeHair(); });
  range("前後", -0.12, 0.18, 0.005, hairFwd, (v) => (v * 100).toFixed(1) + "cm", (v) => { hairFwd = v; placeHair(); });
  box = ui;

  section("目（元モデルのジオメトリ）", false);
  range("左右", -0.03, 0.03, 0.001, eyeX, (v) => (v * 1000).toFixed(0) + "mm", (v) => { eyeX = v; applyEyes(); });
  range("上下", -0.03, 0.03, 0.001, eyeY, (v) => (v * 1000).toFixed(0) + "mm", (v) => { eyeY = v; applyEyes(); });
  range("前後", -0.02, 0.02, 0.001, eyeZ, (v) => (v * 1000).toFixed(0) + "mm", (v) => { eyeZ = v; applyEyes(); });
  range("傾き（縦）", -0.5, 0.5, 0.01, eyePitch, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { eyePitch = v; applyEyes(); });
  range("傾き（横）", -0.5, 0.5, 0.01, eyeYaw, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { eyeYaw = v; applyEyes(); });
  box = ui;

  section("口（板を貼る ※元モデルに口は無い）", false);
  {
    const r = row("表示");
    const b = document.createElement("button");
    b.textContent = mouthOn ? "■ 消す" : "▶ 出す";
    Object.assign(b.style, { background: "rgba(40,46,60,0.95)", color: "#fff",
      border: "1px solid rgba(255,255,255,0.22)", borderRadius: "8px",
      padding: "4px 8px", fontSize: "12px", cursor: "pointer" } as Partial<CSSStyleDeclaration>);
    b.onclick = () => { mouthOn = !mouthOn; b.textContent = mouthOn ? "■ 消す" : "▶ 出す"; placeMouth(); };
    r.appendChild(b);
  }
  range("上下", -0.06, 0.18, 0.002, mouthY, (v) => (v * 100).toFixed(1) + "cm", (v) => { mouthY = v; placeMouth(); });
  range("前後", 0.0, 0.16, 0.002, mouthZ, (v) => (v * 100).toFixed(1) + "cm", (v) => { mouthZ = v; placeMouth(); });
  range("横幅", 0.02, 0.10, 0.002, mouthW, (v) => (v * 100).toFixed(1) + "cm", (v) => { mouthW = v; placeMouth(); });
  range("縦幅", 0.004, 0.06, 0.002, mouthH, (v) => (v * 100).toFixed(1) + "cm", (v) => { mouthH = v; placeMouth(); });
  range("口角", -1, 1, 0.05, mouthCurve, (v) => (v > 0.05 ? "笑い " : v < -0.05 ? "への字 " : "まっすぐ ") + v.toFixed(2), (v) => { mouthCurve = v; drawMouth(); });
  range("開き", 0, 1, 0.02, mouthOpen, (v) => (v * 100).toFixed(0) + "%", (v) => { mouthOpen = v; drawMouth(); });
  range("傾き（縦）", -0.6, 0.6, 0.01, mouthPitch, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { mouthPitch = v; placeMouth(); });
  range("傾き（横）", -0.6, 0.6, 0.01, mouthRoll, (v) => (v * 180 / Math.PI).toFixed(0) + "°", (v) => { mouthRoll = v; placeMouth(); });
  box = ui;

  if (hairUpSlider) hairUpSlider.value = String(hairUp);
  void showHair();
}

/** 素体を読み直す。⚠️ ボーンも目も作り直すので、前のものは全部捨ててから。 */
async function reload(): Promise<void> {
  for (const m of loadedRoots) m.dispose(false, true);
  for (const m of eyeParts) m.dispose(false, true);
  mouth?.dispose(false, true);
  headNode?.dispose(); hairNode?.dispose();
  hairCache.clear();
  eyeParts = []; eyesMesh = null; hairMesh = null; skel = null;
  restScale.clear();
  ui.innerHTML = "";
  ui.appendChild(title); ui.appendChild(infoEl);
  box = ui;
  await load();
}

load().catch((e: unknown) => {
  info = "★ 読み込みに失敗: " + (e instanceof Error ? e.message : String(e));
  console.error(e);
});

engine.runRenderLoop(() => {
  // ⚠️ 毎フレーム作り直す。ボーンを触った結果をシェーダへ確実に届けるため
  //    （上の applyBody でも呼ぶが、髪や目の操作からも確実に反映させる）。
  skel?.prepare(true);
  applyEyes();   // 頭が動いたら目も付いていく
  // ⚠️ 毎フレーム作り直す。スライダーの値ではなく**実際にノードへ入っている値**を
  //    出したいので、押した時だけの更新では足りない。
  infoEl.textContent = skel ? infoText() : info;
  scene.render();
});
window.addEventListener("resize", () => engine.resize());
