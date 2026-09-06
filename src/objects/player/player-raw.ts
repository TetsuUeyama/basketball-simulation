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
import type { RigHandle } from "@objcts/player/rig";
import {
  buildRawModelFrom, buildRawRig, preloadRawSource, type RawModel, type RawSource,
} from "../../voxraw";
import type { RGB } from "../../config";
import type { BoneMap, VoxelBody, VoxelBodyOptions } from "./player-voxel";

/** 生ボクセルのデータ置き場。 */
const RAW_URL = "/vox/player_one";
let source: RawSource | null = null;
let loading: Promise<void> | null = null;
/**
 * 読み終わったときに呼ぶ約束。
 * ⚠️ 選手を組むのは同期処理なので、間に合わなければ従来モデルで組まれてしまう。
 *    ブラウザでは本体の JS 読み込みと競合して実際に間に合わず、試合中のモデルが
 *    旧モデルのままになった。**後から届いたら組み直す**ための入口。
 */
const readyCbs: (() => void)[] = [];

/** 起動時に一度だけ呼ぶ。読み終えるまで `rawReady()` は偽。 */
export function startRawPreload(): Promise<void> {
  if (loading) return loading;
  const t0 = Date.now();
  loading = preloadRawSource(RAW_URL)
    .then((s) => {
      source = s;
      console.info(`生ボクセルの素体を読み込んだ (${Date.now() - t0}ms)`);
    })
    .catch((e: unknown) => {
      console.warn("生ボクセルの読み込みに失敗。従来のモデルを使う:", e);
      source = null;
    })
    .then(() => { const cbs = readyCbs.splice(0); for (const cb of cbs) cb(); });
  return loading;
}
/** 読み込みが終わったら（既に終わっていれば即座に）呼ぶ。 */
export function onRawReady(cb: () => void): void {
  if (source) cb(); else readyCbs.push(cb);
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
function stripBackMarks(mesh: Mesh): void {
  const pos = mesh.getVerticesData("position"); const idx = mesh.getIndices();
  if (!pos || !idx) return;
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    if ([0, 1, 2].every((j) => pos[idx[t + j] * 3 + 2] < MARK_BACK_Z)) continue;
    keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  mesh.setIndices(keep);
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

/**
 * 胴（腰）の半幅を測る。腕を真下へ垂らしたとき胴に当たるかの判定に使う。
 * ⚠️ ジャージで測ってはいけない。静止姿勢は腕を開いた形なので、同じ高さに袖が入る。
 *    ショーツの一番上なら腕は無い。
 */
function torsoHalfWidth(shorts: Mesh): number {
  const p = shorts.getVerticesData("position");
  if (!p) return 0.17;
  let top = -Infinity;
  for (let i = 1; i < p.length; i += 3) if (p[i] > top) top = p[i];
  let x = 0;
  for (let i = 0; i < p.length / 3; i++) {
    if (p[i * 3 + 1] < top - 0.06) continue;
    const v = Math.abs(p[i * 3]);
    if (v > x) x = v;
  }
  return x;
}

/** 形ごとの見本。メッシュのジオメトリだけ使い、描画はしない。 */
interface Proto { model: RawModel; panel: VertexData | null; torsoHalf: number }
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
    if (mark) stripBackMarks(mark);
    // ⚠️ 番号の帯は voxraw が元のボクセルから出したものを使う。面から測ると、
    //    隠れた面を間引いたぶん段が飛んで Name と区別が付かない。
    const band = model.backNumberBand;
    const panel = band && jersey ? backPanel(jersey, band) : null;
    // ⚠️ 板は Spine ノードにぶら下げるので、**ここで一度だけ** Spine ローカルへ移す。
    //    buildRig はノードに位置しか入れない（回転も倍率も単位）ので、Spine の
    //    静止絶対位置を引くだけでよい。身長の倍率はリグより上の枝に掛かるので効かない。
    const spineRest = model.rig.restPosition("Spine");
    if (panel?.positions && spineRest) {
      const q = panel.positions as number[];
      for (let i = 0; i < q.length; i += 3) {
        q[i] -= spineRest.x; q[i + 1] -= spineRest.y; q[i + 2] -= spineRest.z;
      }
    }
    for (const mesh of model.meshes) mesh.setEnabled(false);
    model.root.setEnabled(false);
    const shorts = model.byPart.get("shorts");
    e = { model, panel, torsoHalf: shorts ? torsoHalfWidth(shorts) : 0.17 };
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

/**
 * その体格で使われている見本のモデル。確認ページが統計やあごの形を触るのに使う。
 * ⚠️ 見本は全選手で共有している。ここを書き換えると同じ体格の選手すべてに効く。
 */
export function rawPrototype(scene: Scene, heightM: number, weightKg: number): RawModel | null {
  return proto(scene, thickBucket(heightM, weightKg))?.model ?? null;
}

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
/**
 * 標準ボーン、アニメ側がその親とみなすボーン、静止時の向きを決める先。
 * ⚠️ 向きを決める先は「rig.restDirection」ではなく明示する。restDirection は
 *    子が複数ある骨（Hips は脚2本と Spine）で、どの子が最後に処理されたかで
 *    値が変わってしまう。実測でそれが原因で上腕が真上を向いた（143.6°）。
 * ⚠️ 胴と腰は仮想側も回さない前提なので向きの補正を入れない（単位）。ここに
 *    補正を入れると、下の骨まで連鎖してすべて狂う。
 */
const CHAIN: [string, string | null, string | null][] = [
  ["Hips", null, null],
  ["Spine", "Hips", null],
  ["Head", "Spine", null],
  ["LeftUpperArm", "Spine", "LeftLowerArm"], ["RightUpperArm", "Spine", "RightLowerArm"],
  ["LeftLowerArm", "LeftUpperArm", "LeftHand"], ["RightLowerArm", "RightUpperArm", "RightHand"],
  ["LeftHand", "LeftLowerArm", null], ["RightHand", "RightLowerArm", null],
  ["LeftUpperLeg", "Hips", "LeftLowerLeg"], ["RightUpperLeg", "Hips", "RightLowerLeg"],
  ["LeftLowerLeg", "LeftUpperLeg", "LeftFoot"], ["RightLowerLeg", "RightUpperLeg", "RightFoot"],
  ["LeftFoot", "LeftLowerLeg", null], ["RightFoot", "RightLowerLeg", null],
];
const DOWN = new Vector3(0, -1, 0);
/**
 * アニメの回転を、このモデルのボーン回転へ読み替える表を作る。
 *
 * アニメ側は「骨が真下(0,-1,0)を向いている」前提の仮想の骨組みで回転 V を作る。
 * モデルの骨は静止姿勢でそれぞれ別の向きを向いているので、その差を打ち消す:
 *   ノードの回転 = restRot(親) ⊗ V ⊗ restRot(自分)⁻¹
 *
 * ⚠️ restRot は**このモデル自身の静止姿勢**から出すこと。焼き込みモデルの
 *    partRestRotation を流用していたが、生モデルの静止姿勢は別物なので打ち消し
 *    きれず、真下を向かせたはずの上腕が 33.8° 開いたままだった（手が体の中心から
 *    32cm 外。仮想の骨組みでは 19cm）。これが「肩を広げた不自然な立ち姿」の正体。
 */
function boneMap(rig: RigHandle): VoxelBody["map"] {
  const toward = new Map(CHAIN.map(([b, , t]) => [b, t]));
  const cache = new Map<string, Quaternion>();
  const restRot = (b: string | null): Quaternion => {
    if (!b) return Quaternion.Identity();
    const hit = cache.get(b);
    if (hit) return hit;
    const t = toward.get(b) ?? null;
    let q = Quaternion.Identity();
    if (t) {
      const a = rig.restPosition(b as StandardBoneName), c = rig.restPosition(t as StandardBoneName);
      if (a && c && Vector3.DistanceSquared(a, c) > 1e-9) q = rotationBetween(DOWN, c.subtract(a).normalize());
    }
    cache.set(b, q);
    return q;
  };
  const map = new Map<string, BoneMap>();
  for (const [b, parent] of CHAIN) {
    map.set(b, {
      bone: b as StandardBoneName,
      pre: restRot(parent),
      post: restRot(b).conjugate(),
    });
  }
  return map;
}
/** a を b へ向ける最小の回転。 */
function rotationBetween(a: Vector3, b: Vector3): Quaternion {
  const dot = Vector3.Dot(a, b);
  if (dot > 0.999999) return Quaternion.Identity();
  if (dot < -0.999999) {
    // 真逆。直交する軸を1本選んで180°回す
    const axis = Math.abs(a.x) < 0.9 ? Vector3.Cross(a, Vector3.Right()) : Vector3.Cross(a, Vector3.Up());
    axis.normalize();
    return Quaternion.RotationAxis(axis, Math.PI);
  }
  const axis = Vector3.Cross(a, b);
  const q = new Quaternion(axis.x, axis.y, axis.z, 1 + dot);
  q.normalize();
  return q;
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

// ───────────────────────── 遠景の粗い版 ─────────────────────────
// ⚠️ 26人を近景の細かさで描くと毎フレーム 3.8M 三角形になり、実機でカクついた。
//    数メートル離れれば 1ボクセルは1画素にも満たないので、遠い選手はボクセル2個ぶんに
//    まとめた版（面はおよそ 1/4）へ切り替える。
// 立ち姿で腕を最低これだけは開く（rad）。0 だと腕が体に貼り付いて棒立ちに見える。
const MIN_SPLAY = 0.06;              // ≈3.4°
const ARM_RADIUS = 0.05;             // 上腕の太さの半分（m）
/** 手首から手のひらの当たる点まで（モデル 180.4cm での実測。m）。 */
const PALM_REACH = 0.135;
const LOD_DIST = 12;                 // これより遠い選手は粗い版（m）
const LOD_HYST = 1.5;                // 境目で行ったり来たりしないための余裕（m）
/** 粗い版を持たせる部位。目・口・エンブレム・背番号は遠景では見えないので消すだけ。 */
const LOD_PARTS = new Set(["body", "hair", "jersey", "shorts", "socks", "shoes"]);
const lodOf = (part: string): boolean => LOD_PARTS.has(part) || part.startsWith("hairstyle_");

type LodEntry = { root: TransformNode; fine: Mesh[]; coarse: Mesh[]; far: boolean };
const LOD_REG = new WeakMap<Scene, LodEntry[]>();
/** シーンに1つだけ観測者を置き、カメラからの距離で近景／遠景を切り替える。 */
function lodList(scene: Scene): LodEntry[] {
  const hit = LOD_REG.get(scene);
  if (hit) return hit;
  const all: LodEntry[] = [];
  LOD_REG.set(scene, all);
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i];
      if (e.root.isDisposed()) { all.splice(i, 1); continue; }
      const d = Vector3.Distance(cam.globalPosition, e.root.getAbsolutePosition());
      const far = e.far ? d > LOD_DIST - LOD_HYST : d > LOD_DIST + LOD_HYST;
      if (far === e.far) continue;
      e.far = far;
      for (const m of e.fine) m.setEnabled(!far);
      for (const m of e.coarse) m.setEnabled(far);
    }
  });
  return all;
}

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
  const lodEntry: LodEntry = { root, fine: [], coarse: [], far: false };
  /** 見本のメッシュを1本生やす。 */
  const spawn = (name: string, part: string, src: Mesh): Mesh => {
    if (TINTED(part) && !tinted.has(src)) { normalizeTint(src, TINT_KEEP(part)); tinted.add(src); }
    const m = new Mesh(name, scene);
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
    // ⚠️ alwaysSelectAsActiveMesh は立てない。画面外でも必ず描く指定で、26人ぶんだと
    //    カメラの外の選手まで毎フレーム描くことになる（従来モデルも立てていない）。
    //    静止姿勢の境界箱で判定するので、腕を上げた瞬間に画面端で消えることはあり得るが、
    //    従来モデルと同じ割り切り。
    m.material = matFor(part);
    return m;
  };
  /**
   * 近景ぶんと、あれば遠景ぶんを生やす。
   * 遠景ぶんが無い部位（目・口・エンブレム・背番号）は、遠景では消えるだけ。
   */
  const attach = (part: string, src: Mesh): Mesh => {
    const m = spawn(part + "_" + o.name, part, src);
    own.set(part, m);
    meshes.push(m);
    lodEntry.fine.push(m);
    m.setEnabled(!lodEntry.far);
    const lodSrc = lodOf(part) ? pr.lodPart(part) : null;
    if (lodSrc) {
      const c = spawn("lod_" + part + "_" + o.name, part, lodSrc);
      c.setEnabled(lodEntry.far);
      own.set("lod_" + part, c);
      lodEntry.coarse.push(c);
    }
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
  let hairStyle = "";                    // いま付いている髪型の名前
  let hairWant = "";                     // いま欲しい髪型（読み終わったとき取り違えない用）
  /** メッシュを外して、近景／遠景のどの一覧からも消す。 */
  const drop = (m: Mesh | null | undefined): void => {
    if (!m) return;
    for (const arr of [meshes, lodEntry.fine, lodEntry.coarse]) {
      const i = arr.indexOf(m);
      if (i >= 0) arr.splice(i, 1);
    }
    m.dispose();
  };
  const setHair = (hairNo: number): void => {
    if (hairMesh) {
      drop(hairMesh);
      drop(own.get("lod_" + hairStyle));
      own.delete("lod_" + hairStyle);
      own.delete(hairStyle);
      hairMesh = null;
      hairStyle = "";
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
      hairStyle = name;
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
    // ⚠️ 板の頂点は見本と**同じ配列を共有**している。ここで書き換えてはいけない。
    //    以前は選手ごとに Spine ローカルへ変換していたが、getVerticesData が
    //    共有配列そのものを返すため26人ぶん変換が積み重なり、板がコートの下
    //    （y = -34m）へ沈んだ。Spine ローカルへの変換は見本を作るときに済ませてある。
    pe.panel.applyToMesh(numMesh, false);
    numMesh.isPickable = false;
    numMesh.material = numMat;
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

  // ⚠️ 影は近景・遠景の両方を登録する。無効なほうは描かれないので二重にはならないが、
  //    片方しか入れないと切り替わった側で影が消える。
  const shadowMeshes = ["jersey", "shorts", "shoes", "lod_jersey", "lod_shorts", "lod_shoes"]
    .map((p2) => own.get(p2)).filter((m): m is Mesh => !!m);
  lodList(scene).push(lodEntry);

  const body: VoxelBody = {
    root, rig, skel, map: boneMap(rig),
    spineRest: spineNode ? spineNode.position.clone() : Vector3.Zero(),
    hipsRest: hipsNode ? hipsNode.position.clone() : Vector3.Zero(),
    handRest, wristPivot,
    meshes, shadowMeshes,
    variant: "normal", height: o.height,
    shoulder: { x: sh.x, y: sh.y, z: sh.z },
    hipY: hip.y, kneeY: knee.y, ankleY: ankle.y,
    upperArm: Vector3.Distance(sh, el),
    // 腕を真下へ垂らしたとき、上腕が胴に触れないぶんだけ開く。
    // ⚠️ 焼き込み素体の 35° を流用してはいけない。あちらは肩の関節が胴の内側に
    //    あるための値で、生素体は肩が胴より 4cm 外にあるので開く必要がほぼ無い。
    baseArmSplay: Math.max(MIN_SPLAY,
      Math.atan2(Math.max(0, pe.torsoHalf * k + ARM_RADIUS * k - Math.abs(sh.x)),
        Vector3.Distance(sh, el))),
    armSplay: 0,   // 直立度から毎フレーム決まる（作った直後に下限を入れる）
    // ⚠️ 実効長は**手首まで**。手のひらの当たる点は手首から 135mm 先にあるが、
    //    その向きは手の回し方で変わるので、長さに足し込むと合わない
    //    （手のひらの法線と当たる点は 59° ずれていて、法線をボールへ向けると
    //    当たる点が 116mm 横へ振れる）。当たる点は palm.ts が狙いの式で織り込む。
    foreArm: Vector3.Distance(el, hand),
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
      for (const m of lodEntry.coarse) m.dispose();
      numMesh?.dispose();
      numTex?.dispose();
      skel.dispose();
      rig.dispose();
      modelRoot.dispose();
      root.dispose();
      for (const m of allMats) m.dispose();
    },
  };
  body.armSplay = body.baseArmSplay;
  return body;
}
