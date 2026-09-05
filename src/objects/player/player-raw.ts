// 生ボクセルの選手素体（`public/vox/player_one`）を、ゲームの `VoxelBody` として使うための橋。
//
// なぜ別ファイルか:
//   既存の `player-voxel.ts` は焼き込み済みの body-*.json / cloth-*.json を組む経路で、
//   生ボクセルとはデータも作り方も違う。片方を壊さずに差し替えられるよう分ける。
//
// ⚠️ ゲームは 26 人ぶんを**同期で**組む。生ボクセルの読み込みは非同期なので、起動時に
//    一度 `startRawPreload()` で読み、`rawReady()` が真になってから使う。間に合っていなければ
//    従来の経路にそのまま落ちる（見た目が変わるだけで動作は同じ）。
// ⚠️ 26人ぶんメッシュを別々に作ると 500 万頂点になる。**形が同じものは1体ぶんだけ作って
//    ジオメトリを共有**し、リグとスケルトンだけ人数ぶん作る。形を決めるのは体重（厚み）だけ
//    なので、厚みを数段階に丸めてその段ごとに1体持つ。身長は root の倍率なので共有できる。
import {
  Color3, DynamicTexture, Mesh, Quaternion, Scene, StandardMaterial, TransformNode,
  Vector3, VertexData,
} from "@babylonjs/core";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";
import { partRestRotation } from "@objcts/player/voxel/voxelBody";
import {
  buildRawModelFrom, buildRawRig, preloadRawSource, type RawModel, type RawSource,
} from "../../voxraw";
import type { RGB } from "../../config";
import type { BoneMap, VoxelBody, VoxelBodyOptions } from "./player-voxel";

/** 生ボクセルのデータ置き場。 */
const RAW_URL = "/vox/player_one";
let source: RawSource | null = null;
let loading: Promise<void> | null = null;

/** 起動時に一度だけ呼ぶ。読み終えるまで `rawReady()` は偽。 */
export function startRawPreload(): Promise<void> {
  if (loading) return loading;
  loading = preloadRawSource(RAW_URL)
    .then((s) => { source = s; })
    .catch((e: unknown) => {
      console.warn("生ボクセルの読み込みに失敗。従来のモデルを使う:", e);
      source = null;
    });
  return loading;
}
export function rawReady(): boolean { return source !== null; }
/** 全選手を生モデルにする。 */
export function useRawFor(): boolean { return true; }

// ───────────────────────── 形の共有 ─────────────────────────
// 厚みは連続値だが、段に丸めれば形は同じになるので1体ぶんで足りる。
// 5段で 0.85〜1.15（選手データの BMI 17.0〜29.4 に対応）を覆う。
const THICK_STEPS = 5;
const THICK_MIN = 0.85, THICK_MAX = 1.15;
function thickBucket(heightM: number, weightKg: number): number {
  const t = Math.sqrt(weightKg / (23.1 * heightM * heightM));
  const c = Math.min(THICK_MAX, Math.max(THICK_MIN, t));
  return Math.round(((c - THICK_MIN) / (THICK_MAX - THICK_MIN)) * (THICK_STEPS - 1));
}
/** 段の代表となる体重（身長 180.4cm のときの値）。 */
function bucketWeight(b: number): number {
  const t = THICK_MIN + (b / (THICK_STEPS - 1)) * (THICK_MAX - THICK_MIN);
  return 23.1 * 1.804 * 1.804 * t * t;
}

// ───────────────────────── 背中の番号 ─────────────────────────
// ⚠️ jerseymark（エンブレム・背番号・Name）は元のテクスチャから焼いたもので、番号は
//    「8」・名前も1人ぶんしか無い。26人全員が背番号8になるので、**背中側だけ捨てて**
//    選手ごとの番号を描いた面を貼り直す。前面のエンブレム類はキットの柄なので残す。
const MARK_BACK_Z = -0.05;              // これより後ろ（-Z）が背中側

/** 背中側の三角形を落とす（頂点はそのまま。共有ジオメトリに1回だけ）。 */
function stripBackMarks(mesh: Mesh): { yLo: number; yHi: number; xLo: number; xHi: number } | null {
  const pos = mesh.getVerticesData("position"); const idx = mesh.getIndices();
  if (!pos || !idx) return null;
  const keep: number[] = [];
  let yLo = Infinity, yHi = -Infinity, xLo = Infinity, xHi = -Infinity;
  const ys: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const back = [0, 1, 2].every((j) => pos[idx[t + j] * 3 + 2] < MARK_BACK_Z);
    if (!back) { keep.push(idx[t], idx[t + 1], idx[t + 2]); continue; }
    for (let j = 0; j < 3; j++) {
      const y = pos[idx[t + j] * 3 + 1], x = pos[idx[t + j] * 3];
      ys.push(y);
      if (x < xLo) xLo = x; if (x > xHi) xHi = x;
    }
  }
  mesh.setIndices(keep);
  if (!ys.length) return null;
  // ⚠️ 背中には番号と Name の2つが乗っている。下の塊が番号なので、高さを並べて
  //    **最初の切れ目**までを番号の帯とする。切れ目は実測 10mm、マークのボクセルは
  //    4.69mm なので、その間の 7mm をしきい値にする（4mm 刻みのヒストグラムだと
  //    ボクセルの段そのものが切れ目に見えて、帯が 20mm しか取れなかった）。
  const GAP = 0.007;
  const sorted = [...new Set(ys.map((y) => Math.round(y * 2000) / 2000))].sort((a, b) => a - b);
  yLo = sorted[0]; yHi = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - yHi > GAP) break;
    yHi = sorted[i];
  }
  return { yLo, yHi, xLo, xHi };
}

/**
 * 背中の面（番号を描く板）。ジャージの背面をなぞって作るので、体型が変わっても浮かない。
 * ⚠️ 平らな板や円筒では合わない。胴の断面は楕円で、しかも番号の帯は 21cm もあり
 *    腰へ向かって細くなる。**格子状に (x,y) ごとの一番後ろの z を拾って**面を張り、
 *    そのぶんだけ外へずらす（x だけで拾うと、板が真っ平らになって端が背中から
 *    4cm 近く浮いた）。
 */
function backPanel(jersey: Mesh, band: { yLo: number; yHi: number; xLo: number; xHi: number }): VertexData | null {
  const pos = jersey.getVerticesData("position");
  if (!pos) return null;
  const NX = 14, NY = 10, OUT = 0.004;
  const x0 = band.xLo - 0.004, x1 = band.xHi + 0.004;
  const y0 = band.yLo, y1 = band.yHi;
  const n = (NX + 1) * (NY + 1);
  const z = new Float64Array(n);
  const hit = new Uint8Array(n);
  for (let i = 0; i < pos.length / 3; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    if (pz > MARK_BACK_Z || py < y0 || py > y1 || px < x0 || px > x1) continue;
    const bx = Math.round(((px - x0) / (x1 - x0)) * NX);
    const by = Math.round(((py - y0) / (y1 - y0)) * NY);
    const k = by * (NX + 1) + bx;
    if (!hit[k] || pz < z[k]) { z[k] = pz; hit[k] = 1; }
  }
  // 拾えなかった格子は、埋まっている中で一番近いところから借りる
  for (let k = 0; k < n; k++) {
    if (hit[k]) continue;
    const kx = k % (NX + 1), ky = (k / (NX + 1)) | 0;
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (!hit[j]) continue;
      const d = Math.abs((j % (NX + 1)) - kx) + Math.abs(((j / (NX + 1)) | 0) - ky);
      if (d < bd) { bd = d; best = j; }
    }
    z[k] = best >= 0 ? z[best] : -0.15;
  }
  const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      positions.push(x0 + ((x1 - x0) * i) / NX, y0 + ((y1 - y0) * j) / NY, z[j * (NX + 1) + i] - OUT);
      uvs.push(1 - i / NX, j / NY);      // 背中側(-Z)から見て左から右に読めるように
      normals.push(0, 0, -1);
    }
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a2 = j * (NX + 1) + i, b2 = a2 + 1, c2 = a2 + NX + 1, d2 = c2 + 1;
      indices.push(a2, c2, b2, b2, c2, d2);
    }
  }
  const vd = new VertexData();
  vd.positions = positions; vd.indices = indices; vd.uvs = uvs; vd.normals = normals;
  return vd;
}

/** 形ごとの見本。メッシュのジオメトリだけ使い、描画はしない。 */
interface Proto { model: RawModel; panel: VertexData | null }
const PROTO = new WeakMap<Scene, Map<number, Proto>>();
function proto(scene: Scene, bucket: number): Proto | null {
  if (!source) return null;
  let store = PROTO.get(scene);
  if (!store) { store = new Map(); PROTO.set(scene, store); }
  let e = store.get(bucket);
  if (!e) {
    const model = buildRawModelFrom(scene, source);
    model.setBody(180.4, bucketWeight(bucket));
    const mark = model.byPart.get("jerseymark");
    const jersey = model.byPart.get("jersey");
    const band = mark ? stripBackMarks(mark) : null;
    const panel = band && jersey ? backPanel(jersey, band) : null;
    for (const mesh of model.meshes) mesh.setEnabled(false);
    model.root.setEnabled(false);
    e = { model, panel };
    store.set(bucket, e);
  }
  return e;
}

/**
 * 髪型の見本。⚠️ 頭は体格で厚みを変えていない（THICK_BY_BONE の Head は 0）ので、
 * 体格の段ごとに持つ必要は無い。名前1つにつき1本、全選手で共有する。
 * ⚠️ 同じ髪型を複数人が同時に頼むので、**約束（Promise）を覚える**。読み込み中かどうかの
 *    印だけだと、2人目以降がずっと髪無しのままになる。
 */
const HAIR_PROTO = new WeakMap<Scene, Map<string, Promise<Mesh | null>>>();

/** 選手の髪型番号 → データにある髪型名。無ければ順番で近いものへ寄せる。 */
export function hairPartName(hairNo: number): string | null {
  if (!source || hairNo <= 0) return null;
  const want = `hairstyle_${String(hairNo).padStart(3, "0")}`;
  if (source.hairNames.includes(want)) return want;
  // ⚠️ 139種は 001〜140 の飛び番（髭単体などを除いてある）。無い番号は順番で近いものへ。
  return source.hairNames[hairNo % source.hairNames.length] ?? null;
}

// ───────────────────────── 回転の読み替え ─────────────────────────
/**
 * ⚠️ 恒等にしてはいけない。この表は**アニメが前提とする仮想の向き**を表すもので、
 *    メッシュの付け方とは独立。焼き込みモデルは腕パーツが 62.6° 回った状態で切り出されて
 *    おり、post = rr(部位) の逆 でそれを打ち消している。生モデルでも同じ読み替えが要る。
 *    恒等にしたら、ゲーム内で腕を横に広げた格好のまま動いた（ズレ量が 62.6° と一致）。
 */
const CHAIN: [string, string, string | null][] = [
  ["Hips", "hips", null],
  ["Spine", "torso", "hips"],
  ["Head", "head", "torso"],
  ["LeftUpperArm", "upperArmL", "torso"], ["RightUpperArm", "upperArmR", "torso"],
  ["LeftLowerArm", "foreArmL", "upperArmL"], ["RightLowerArm", "foreArmR", "upperArmR"],
  ["LeftHand", "handL", "foreArmL"], ["RightHand", "handR", "foreArmR"],
  ["LeftUpperLeg", "thighL", "hips"], ["RightUpperLeg", "thighR", "hips"],
  ["LeftLowerLeg", "shinL", "thighL"], ["RightLowerLeg", "shinR", "thighR"],
  ["LeftFoot", "footL", "shinL"], ["RightFoot", "footR", "shinR"],
];
function boneMap(): VoxelBody["map"] {
  const rr = (part: string): Quaternion => {
    const q = partRestRotation(part);
    return new Quaternion(q[0], q[1], q[2], q[3]);
  };
  const map = new Map<string, BoneMap>();
  for (const [b, part, parent] of CHAIN) {
    map.set(b, {
      bone: b as StandardBoneName,
      pre: parent ? rr(parent) : Quaternion.Identity(),
      post: rr(part).conjugate(),
    });
  }
  return map;
}

// ───────────────────────── 色 ─────────────────────────
// 生モデルの色は頂点に焼いてある（肌は 70〜75 階調のまだら、髪は実測で平均 24,11,10）。
//
// ⚠️ 「基準色で割った倍率」で染めてはいけない。髪の基準はほぼ黒なので、金髪
//    (#e0c98a) にすると倍率が 9〜18 倍になり、まだらの明るい粒が全部白へ振り切れる。
//    そこで**まだらを明るさだけに直して平均を 1.0 に揃え**、色はマテリアルの diffuse で
//    与える（頂点色 × diffuse なので、平均が狙いの色になり、まだらは残る）。
const TINT_LO = 0.30, TINT_HI = 1.80;   // まだらの振れ幅（1.0 が平均）
/**
 * 元のばらつきをどれだけ残すか。
 * ⚠️ 肌は 70〜75 階調が狭い幅に固まっているので、そのまま(1.0)残す。落とすと
 *    「まだらにしてほしい」と言われた顔がのっぺりに戻る。
 * ⚠️ 髪とユニフォームは振れ幅が桁違い（髪は最頻 6,2,2 に対し平均 24,11,10、
 *    ジャージは赤地に黄の柄）なので、そのままだと上下の頭打ちに張り付いて
 *    平均が狙いの色からズレる。半分ほどに詰める。
 */
const TINT_KEEP = (part: string): number => (part === "body" ? 1.0 : 0.45);
/** 頂点色を「明るさのばらつき（平均1.0）」に直す。共有ジオメトリに1回だけ掛ける。 */
function normalizeTint(mesh: Mesh, keep: number): void {
  const c = mesh.getVerticesData("color");
  if (!c) return;
  const n = c.length / 4;
  const lum = (i: number): number => 0.299 * c[i * 4] + 0.587 * c[i * 4 + 1] + 0.114 * c[i * 4 + 2];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += lum(i);
  const avg = sum / Math.max(1, n);
  if (avg < 1e-4) return;
  for (let i = 0; i < n; i++) {
    const g = Math.min(TINT_HI, Math.max(TINT_LO, (1 - keep) + keep * (lum(i) / avg)));
    c[i * 4] = g; c[i * 4 + 1] = g; c[i * 4 + 2] = g;
  }
  mesh.setVerticesData("color", c, false);
}
/** 明るさに直して染める部位。⚠️ face（目・口）と jerseymark（エンブレム・背番号）は元の色のまま。 */
const TINTED = (part: string): boolean =>
  part === "body" || part === "hair" || part.startsWith("hairstyle_")
  || part === "jersey" || part === "shorts" || part === "socks" || part === "shoes";
function rgb3(c: RGB): Color3 { return new Color3(c.r, c.g, c.b); }
/** 既に明るさへ直した見本メッシュ。共有ジオメトリなので二重に掛けない。 */
const tinted = new WeakSet<Mesh>();

/** 生ボクセルで素体を組む。読み込みが終わっていなければ null。 */
export function buildRawVoxelBody(
  scene: Scene, parent: TransformNode, o: VoxelBodyOptions & { weight?: number },
): VoxelBody | null {
  if (!source) return null;
  const weightKg = o.weight ?? 23.1 * o.height * o.height;
  const pe = proto(scene, thickBucket(o.height, weightKg));
  if (!pe) return null;
  const pr = pe.model;

  const root = new TransformNode(`rawvox_${o.name}`, scene);
  root.parent = parent;
  const { root: modelRoot, rig, skel } = buildRawRig(scene, source);
  modelRoot.parent = root;

  const mat = (tag: string, spec: number, diffuse: Color3): StandardMaterial => {
    const m = new StandardMaterial(`raw${tag}_${o.name}`, scene);
    m.specularColor = new Color3(spec, spec, spec);
    m.diffuseColor = diffuse;
    return m;
  };
  const skinMat = mat("skin", 0.05, rgb3(o.skin));
  const hairMat = mat("hair", 0.03, rgb3(o.hair));
  const topMat = mat("top", 0.06, rgb3(o.kit.top));
  const bottomMat = mat("bottom", 0.06, rgb3(o.kit.bottom));
  const shoeMat = mat("shoe", 0.06, rgb3(o.kit.shoes));
  // 目・口・エンブレム・背番号は焼いてある色のまま出す（染めない）
  const markMat = mat("mark", 0.05, new Color3(1, 1, 1));
  const allMats = [skinMat, hairMat, topMat, bottomMat, shoeMat, markMat];
  const matFor = (part: string): StandardMaterial =>
    part === "body" ? skinMat
      : part === "hair" || part.startsWith("hairstyle_") ? hairMat
        : part === "jersey" ? topMat
          : part === "shorts" ? bottomMat
            : part === "socks" || part === "shoes" ? shoeMat
              : markMat;

  /**
   * 見本のメッシュをこの選手用に生やす。ジオメトリは**同じ実体を貼るだけ**。
   * ⚠️ Mesh.clone は使わない。頂点データを丸ごと複製するので、実測で 8 部位あたり
   *    168ms（26人で 4.4 秒）掛かった。Geometry.applyToMesh なら同じ 8 部位が 0.4ms。
   */
  const own = new Map<string, Mesh>();
  const meshes: Mesh[] = [];
  const attach = (part: string, src: Mesh): Mesh => {
    if (TINTED(part) && !tinted.has(src)) { normalizeTint(src, TINT_KEEP(part)); tinted.add(src); }
    const m = new Mesh(`${part}_${o.name}`, scene);
    src.geometry?.applyToMesh(m);
    // 見本の姿勢はそのまま引き継ぐ（生モデルは単位行列だが、崩れたら気づけるように写す）
    m.position.copyFrom(src.position);
    m.scaling.copyFrom(src.scaling);
    if (src.rotationQuaternion) m.rotationQuaternion = src.rotationQuaternion.clone();
    else m.rotation.copyFrom(src.rotation);
    m.isPickable = false;
    m.parent = modelRoot;
    m.skeleton = skel;             // 姿勢は選手ごとのスケルトンが決める
    m.numBoneInfluencers = 4;
    m.alwaysSelectAsActiveMesh = true;
    m.material = matFor(part);
    own.set(part, m);
    meshes.push(m);
    return m;
  };
  for (const [part, src] of pr.byPart) {
    if (part.startsWith("hairstyle_")) continue;   // 髪型は下で選んだものだけ
    attach(part, src);
  }

  // --- 髪型（選手ごと） -----------------------------------------------------
  // ⚠️ 髪型は 139 種・19MB あるので先読みしない。選手が使うものだけ後から読んで足す。
  //    読み終わるまでは髪無しで描かれる。
  let hairMesh: Mesh | null = null;
  let hairWant = "";                     // いま欲しい髪型（読み終わったとき取り違えない用）
  const setHair = (hairNo: number): void => {
    if (hairMesh) {
      const i = meshes.indexOf(hairMesh);
      if (i >= 0) meshes.splice(i, 1);
      hairMesh.dispose();
      hairMesh = null;
    }
    const name = hairPartName(hairNo);
    hairWant = name ?? "";
    if (!name) return;
    let store = HAIR_PROTO.get(scene);
    if (!store) { store = new Map(); HAIR_PROTO.set(scene, store); }
    let job = store.get(name);
    if (!job) {
      job = pr.loadHair(name).then(() => {
        const src2 = pr.byPart.get(name) ?? null;
        src2?.setEnabled(false);         // 見本は描かない
        return src2;
      });
      store.set(name, job);
    }
    void job.then((src2) => {
      if (!src2 || hairWant !== name || root.isDisposed()) return;
      hairMesh = attach(name, src2);
    });
  };
  setHair(o.hairNo);

  // --- 身長・肩幅 -----------------------------------------------------------
  // ⚠️ 単純に 目標/モデル では合わない。頭だけ伸縮を控えめ(k^0.5)にしているので、
  //    その解を素体側に解かせる。肩幅も、共有したジオメトリが作られた厚みに合わせる。
  pr.applyTo(modelRoot, rig, o.height * 100);

  // --- 測定値（aimArm / reachIK が使う） -----------------------------------
  // ⚠️ rig.restPosition() は**伸縮前**の rest なので、身長も肩幅も入っていない。
  //    ここは実際に描かれる位置が要るので、ノードの実位置を root ローカルで測る。
  root.computeWorldMatrix(true);
  const inv = root.getWorldMatrix().clone().invert();
  const at = (b: string, fb: Vector3): Vector3 => {
    const n = rig.node(b as StandardBoneName);
    if (!n) return fb;
    n.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(n.getAbsolutePosition(), inv);
  };
  const k = modelRoot.scaling.x;
  const sh = at("LeftUpperArm", new Vector3(-0.12 * k, 1.4 * k, 0));
  const el = at("LeftLowerArm", sh);
  const hand = at("LeftHand", el);
  const hip = at("LeftUpperLeg", new Vector3(0, 0.95 * k, 0));
  const knee = at("LeftLowerLeg", new Vector3(0, hip.y * 0.5, 0));
  const ankle = at("LeftFoot", new Vector3(0, 0.12 * k, 0));
  const spineNode = rig.node("Spine");
  const hipsNode = rig.node("Hips");

  // --- 背番号 ---------------------------------------------------------------
  // ⚠️ Spine ノードにぶら下げる。syncVoxelPose は numberSide が +1 のとき
  //    vb.root を Y に 180° 回すので、板は1枚で前後どちらにも回る（焼き込み側と同じ）。
  let numTex: DynamicTexture | null = null;
  let numMesh: Mesh | null = null;
  const drawNumber = (text: string, color: string): void => {
    if (!numTex) return;
    const ctx = numTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.font = "bold 88px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 68);
    numTex.update();
  };
  if (pe.panel && spineNode) {
    numTex = new DynamicTexture(`rawnum_${o.name}`, { width: 128, height: 128 }, scene, false);
    numTex.hasAlpha = true;
    const numMat = new StandardMaterial(`rawnummat_${o.name}`, scene);
    numMat.diffuseColor = new Color3(0, 0, 0);
    numMat.emissiveColor = new Color3(1, 1, 1);
    numMat.specularColor = new Color3(0, 0, 0);
    numMat.disableLighting = true;
    numMat.backFaceCulling = false;
    numMat.diffuseTexture = numTex;
    numMat.opacityTexture = numTex;
    allMats.push(numMat);
    numMesh = new Mesh(`rawnumshell_${o.name}`, scene);
    pe.panel.applyToMesh(numMesh, false);
    numMesh.isPickable = false;
    numMesh.material = numMat;
    // 板は素体の座標で作ってあるので、Spine ローカルへ移してから親付けする
    // （Spine は身長ぶんの倍率が掛かった枝の中にあるので、その差分も一緒に消える）。
    modelRoot.computeWorldMatrix(true);
    spineNode.computeWorldMatrix(true);
    const toSpine = modelRoot.getWorldMatrix().multiply(spineNode.getWorldMatrix().clone().invert());
    const vp = numMesh.getVerticesData("position")!;
    for (let i = 0; i < vp.length; i += 3) {
      const v = Vector3.TransformCoordinates(new Vector3(vp[i], vp[i + 1], vp[i + 2]), toSpine);
      vp[i] = v.x; vp[i + 1] = v.y; vp[i + 2] = v.z;
    }
    numMesh.setVerticesData("position", vp, false);
    numMesh.parent = spineNode;
    numMesh.isVisible = false;    // Game が背中側を決める（setNumberVisible）まで出さない
    drawNumber(o.jerseyText, "white");
  }
  const handRest = new Map<string, Vector3>();
  const wristPivot = new Map<string, Vector3>();
  for (const b of ["LeftHand", "RightHand"]) {
    const n = rig.node(b as StandardBoneName);
    if (n) handRest.set(b, n.position.clone());
    // ⚠️ 生モデルは Mixamo 命名で手のボーンが**手首**にある。焼き込みモデルのように
    //    ボーン原点が前腕の中ほどに立つズレは無いので、回転の軸は原点でよい。
    wristPivot.set(b, Vector3.Zero());
  }

  const shadowMeshes = ["jersey", "shorts", "shoes"]
    .map((p2) => own.get(p2)).filter((m): m is Mesh => !!m);

  const body: VoxelBody = {
    root, rig, skel, map: boneMap(),
    spineRest: spineNode ? spineNode.position.clone() : Vector3.Zero(),
    hipsRest: hipsNode ? hipsNode.position.clone() : Vector3.Zero(),
    handRest, wristPivot,
    meshes, shadowMeshes,
    variant: "normal", height: o.height,
    shoulder: { x: sh.x, y: sh.y, z: sh.z },
    hipY: hip.y, kneeY: knee.y, ankleY: ankle.y,
    upperArm: Vector3.Distance(sh, el),
    // ⚠️ 焼き込みモデルは手のひらの中心までを実効長にしている。生モデルは手ボーンが
    //    手首にあるので、手のひらぶんを足す。
    foreArm: Vector3.Distance(el, hand) * 1.12,
    setSkinColor: (c) => { skinMat.diffuseColor = rgb3(c); },
    setHairColor: (c) => { hairMat.diffuseColor = rgb3(c); },
    setHairStyle: (n) => { setHair(n); },
    setKit: (kit) => {
      topMat.diffuseColor = rgb3(kit.top);
      bottomMat.diffuseColor = rgb3(kit.bottom);
      shoeMat.diffuseColor = rgb3(kit.shoes);
    },
    setJerseyText: drawNumber,
    setNumberVisible: (v) => { if (numMesh) numMesh.isVisible = v; },
    dispose: () => {
      for (const m of meshes) m.dispose();
      numMesh?.dispose();
      numTex?.dispose();
      skel.dispose();
      rig.dispose();
      modelRoot.dispose();
      root.dispose();
      for (const m of allMats) m.dispose();
    },
  };
  return body;
}
