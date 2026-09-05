// voxel-pipeline の出力（.vox + grid.json + weights.json + skeleton.json）を**そのまま**描き、
// **モデル自身のスケルトン**でモーションを当てる。
//
// ゲーム用の焼き込み（body-*.json）は通さない。あれは 15mm へのダウンサンプル、
// 15部位への分割、キットの単色塗り替えという「今のゲームのモデル体系のルール」を
// かけるので、モデルの正確さを見るのには使えない。
//
// 仕組み:
//   1. skeleton.json（モデル自身の骨）の rest 位置を標準ボーン名へ読み替えて RestPose を作る
//   2. buildRig でリグを組む（＝モーションクリップが当てられる形）
//   3. リグのノードへ linkTransformNode した Skeleton を作る
//   4. 生ボクセルを **weights.json のウェイトのまま** スキニングメッシュにする
//      （剛体で骨ごとに切ると関節で裂ける。ウェイトを混ぜて GPU に変形させる）
//   5. applyMotion → skel.prepare() で変形
import {
  Bone, Color3, Matrix, Mesh, Scene, Skeleton, StandardMaterial, TransformNode, VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { buildRig, type RigHandle } from "@objcts/player/rig";
import { restPoseFrom } from "@objcts/player/restPose";
import { MIXAMO_NO_PREFIX } from "@objcts/player/presets";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";

export interface VoxChunk {
  vox_file: string;
  grid_origin: [number, number, number];
  gx: number; gy: number; gz: number;
}
export interface PartGrid {
  voxel_size: number;
  grid_origin: [number, number, number];
  gx: number; gy: number; gz: number;
  chunks?: VoxChunk[];
}
interface PartWeights { bones: string[]; weights: [number, number][][] }
interface SkeletonJson { bones: { name: string; head_rest: number[] }[] }

/** MagicaVoxel .vox → { voxels: [x,y,z,colorIndex][], palette: [r,g,b][] }。 */
export function parseVox(buf: ArrayBuffer): { voxels: Uint8Array[]; palette: number[][] } {
  const b = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const voxels: Uint8Array[] = [];
  let palette: number[][] | null = null;
  let p = 8;
  const id = (at: number): string => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
  const walk = (end: number): void => {
    while (p < end) {
      const tag = id(p);
      const n = b.getInt32(p + 4, true);
      const m = b.getInt32(p + 8, true);
      p += 12;
      const content = p;
      if (tag === "XYZI") {
        const c = b.getInt32(content, true);
        for (let i = 0; i < c; i++) {
          const o = content + 4 + i * 4;
          voxels.push(u8.subarray(o, o + 4));
        }
      } else if (tag === "RGBA") {
        palette = [];
        for (let i = 0; i < 256; i++) {
          const o = content + i * 4;
          palette.push([u8[o], u8[o + 1], u8[o + 2]]);
        }
      }
      p = content + n;
      const childEnd = p + m;
      if (m > 0) walk(childEnd);
      p = childEnd;
    }
  };
  walk(buf.byteLength);
  return { voxels, palette: palette ?? Array.from({ length: 256 }, () => [180, 180, 180]) };
}

/** Blender(Z-up, 右手) → Babylon(Y-up, 左手)。objcts の焼き込みと同じ規約。 */
export const toBabylon = (x: number, y: number, z: number): [number, number, number] => [-x, z, -y];

/**
 * モデルのボーン名 → 標準ボーン名。指・つま先は親の骨へ寄せる
 * （リグに指の節が無いので、そこへ貼ると宙に浮く）。
 */
function standardOf(bone: string): StandardBoneName | null {
  const b = bone.replace(/^mixamorig:?/i, "");
  if (/^Hips$/i.test(b)) return "Hips";
  if (/^Spine2$/i.test(b)) return "Chest";
  if (/^Spine1?$/i.test(b)) return "Spine";
  if (/^Neck/i.test(b)) return "Neck";
  if (/^Head/i.test(b)) return "Head";
  const s = /^Left/i.test(b) ? "Left" : (/^Right/i.test(b) ? "Right" : null);
  if (!s) return null;
  // ⚠️ "Left" は4文字・"Right" は5文字。固定長で切ると左側だけ全部ずれる。
  const rest = b.slice(s.length);
  if (/^Hand/i.test(rest)) return `${s}Hand` as StandardBoneName;          // 指も手へ
  if (/^Shoulder$/i.test(rest)) return `${s}Shoulder` as StandardBoneName;
  if (/^ForeArm/i.test(rest)) return `${s}LowerArm` as StandardBoneName;
  if (/^Arm$/i.test(rest)) return `${s}UpperArm` as StandardBoneName;
  if (/^UpLeg$/i.test(rest)) return `${s}UpperLeg` as StandardBoneName;
  if (/^Leg$/i.test(rest)) return `${s}LowerLeg` as StandardBoneName;
  if (/^(Foot|ToeBase|Toe_End)/i.test(rest)) return `${s}Foot` as StandardBoneName;
  return null;
}
/** 検証用に公開（headless_sim/probe-bonesplit.ts）。 */
export const standardOfForTest = standardOf;

/** リグのノード階層をなぞる Skeleton。各ボーンはノードへリンクする（player-voxel と同じ作り）。 */
function buildSkeleton(scene: Scene, rig: RigHandle, name: string):
    { skel: Skeleton; index: Map<string, number> } {
  const skel = new Skeleton(`skel_${name}`, `skel_${name}`, scene);
  const index = new Map<string, number>();
  const made = new Map<string, Bone>();
  const nodeBone = new Map<TransformNode, string>();
  for (const b of rig.bones) { const n = rig.node(b); if (n) nodeBone.set(n, b); }
  const parentBoneOf = (b: string): string | null => {
    let p = rig.node(b as StandardBoneName)?.parent as TransformNode | null;
    while (p) {
      const hit = nodeBone.get(p);
      if (hit) return hit;
      p = p.parent as TransformNode | null;
    }
    return null;
  };
  const make = (b: string): Bone | null => {
    const hit = made.get(b);
    if (hit) return hit;
    const n = rig.node(b as StandardBoneName);
    if (!n) return null;
    const pb = parentBoneOf(b);
    const bone = new Bone(b, skel, pb ? make(pb) : null,
      Matrix.Translation(n.position.x, n.position.y, n.position.z));
    bone.linkTransformNode(n);
    made.set(b, bone);
    index.set(b, bone.getIndex());
    return bone;
  };
  for (const b of rig.bones) make(b);
  return { skel, index };
}

// 立方体の6面。[法線, その面の4隅（単位立方体の -0.5..0.5）]
const FACES: { n: [number, number, number]; d: [number, number, number]; q: [number, number, number][] }[] = [
  { n: [1, 0, 0], d: [1, 0, 0], q: [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]] },
  { n: [-1, 0, 0], d: [-1, 0, 0], q: [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]] },
  { n: [0, 1, 0], d: [0, 1, 0], q: [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]] },
  { n: [0, -1, 0], d: [0, -1, 0], q: [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]] },
  { n: [0, 0, 1], d: [0, 0, 1], q: [[.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [-.5, -.5, .5]] },
  { n: [0, 0, -1], d: [0, 0, -1], q: [[-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [.5, -.5, -.5]] },
];

/** 服として扱う部位（この内側の肌は描かない）。 */
const CLOTH_PARTS = new Set(["jersey", "shorts", "socks", "shoes", "tshirt", "jeans"]);
/** 髪の部位か（モデル本来の hair と、差し替え用の hairstyle_NNN）。 */
const isHairPart = (p: string): boolean => p === "hair" || p.startsWith("hairstyle_");
/** 方位の分割数。高さ×方位ごとに「服の一番外側の半径」を持つ。 */
const SECTORS = 24;

/**
 * 服に覆われた肌を落とすための判定を作る（焼き込み側 clothOuter と同じ考え方）。
 * 高さの層ごとに服の重心を軸とし、方位ごとの最大半径を持つ。
 * その半径より内側にある肌のボクセルは「服の中」なので描かない。
 */
function clothCover(
  cloth: { x: number; y: number; z: number }[], layer: number,
): (x: number, y: number, z: number, margin: number) => boolean {
  const acc = new Map<number, [number, number, number]>();
  for (const c of cloth) {
    const L = Math.round(c.z / layer);
    let a = acc.get(L);
    if (!a) { a = [0, 0, 0]; acc.set(L, a); }
    a[0] += c.x; a[1] += c.y; a[2]++;
  }
  const axis = new Map<number, [number, number]>();
  for (const [L, a] of acc) axis.set(L, [a[0] / a[2], a[1] / a[2]]);

  const outer = new Map<string, number>();
  const key = (L: number, s: number): string => L + "," + ((s % SECTORS) + SECTORS) % SECTORS;
  const put = (L: number, s: number, r: number): void => {
    const k = key(L, s);
    const cur = outer.get(k);
    if (cur === undefined || cur < r) outer.set(k, r);
  };
  const sectorOf = (dx: number, dy: number): number =>
    Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * SECTORS);

  for (const c of cloth) {
    const L = Math.round(c.z / layer);
    const ax = axis.get(L);
    if (!ax) continue;
    const dx = c.x - ax[0], dy = c.y - ax[1];
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) continue;
    const s = sectorOf(dx, dy);
    // 隣の方位にも広げる（縫い目で肌が点々と残らないように）
    put(L, s - 1, r); put(L, s, r); put(L, s + 1, r);
  }

  return (x, y, z, margin) => {
    const L = Math.round(z / layer);
    const ax = axis.get(L);
    if (!ax) return false;
    const dx = x - ax[0], dy = y - ax[1];
    const o = outer.get(key(L, sectorOf(dx, dy)));
    // 服の方が外側にある = この肌は服の中に隠れている
    return o !== undefined && o > Math.hypot(dx, dy) + margin;
  };
}

export interface RawModel {
  rig: RigHandle;
  root: TransformNode;
  skel: Skeleton;
  meshes: Mesh[];
  /** 部位名 → メッシュ。髪型の出し分けに使う。 */
  byPart: Map<string, Mesh>;
  voxelCount: number;
  triangles: number;
  /** 服に隠れて描かなかった肌のボクセル数。 */
  skinDropped: number;
  /**
   * 髪の下になる頭皮を、その髪の色で塗る。戻り値は塗ったボクセル数。
   * 髪型を切り替えるたびに呼ぶ。`""` を渡すと元の肌色へ戻す。
   *
   * なぜ要るか: 髪はメッシュの表面だけをボクセル化するので、髪の殻と頭皮の間に
   * 隙間が残ると、そこから地肌が見えて「頭頂・後頭部が禿げている」ように見える。
   * 幾何のフィット（voxel-pipeline 側）で隙間は 0〜4cm まで詰めたが、髪型ごとの
   * 形の差までは吸収しきれないので、色でも塞ぐ。
   */
  applyScalpTint(part: string): number;
  height: number;
  perBone: Map<string, number>;
}

/**
 * 生の出力を読み込み、モデル自身のスケルトンへ**スキニングして**返す。
 * `applyMotion(model.rig, clip, t)` → `model.skel.prepare()` で変形する。
 */
export async function buildRawModel(scene: Scene, baseUrl: string): Promise<RawModel> {
  // ⚠️ 404 を握り潰すと「真っ黒だが例外も出ない」になる。必ず落とす。
  const get = async <T>(f: string): Promise<T> => {
    const r = await fetch(`${baseUrl}/${f}`);
    if (!r.ok) throw new Error(`${f} が読めない (HTTP ${r.status})。scripts/sync-voxraw.mjs を流したか？`);
    return await r.json() as T;
  };
  const manifest = await get<{ parts: { prefix: string; grid: string; weights?: string }[] }>("manifest.json");
  const skelJson = await get<SkeletonJson>("skeleton.json");
  const rootGrid = await get<{ bb_min: number[]; bb_max: number[] }>("grid.json");
  const height = rootGrid.bb_max[2] - rootGrid.bb_min[2];

  // --- 1. モデル自身の rest → 標準ボーン名の RestPose → リグ → Skeleton ---
  const src: Record<string, [number, number, number]> = {};
  for (const b of skelJson.bones) src[b.name] = toBabylon(b.head_rest[0], b.head_rest[1], b.head_rest[2]);
  const rest = restPoseFrom(src, MIXAMO_NO_PREFIX, "left", height);
  const root = new TransformNode("rawRoot", scene);
  const rig = buildRig(scene, rest, { name: "raw", parent: root, allowMissing: true });
  const { skel, index } = buildSkeleton(scene, rig, "raw");

  const mat = new StandardMaterial("rawMat", scene);
  // ⚠️ specularColor は Color3。Vector3 を入れると r/g/b が undefined になって描画が壊れる。
  mat.diffuseColor = new Color3(1, 1, 1);      // 色は頂点カラー（焼き込んだ元の色）が持つ
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = true;

  const meshes: Mesh[] = [];
  const byPart = new Map<string, Mesh>();
  const perBone = new Map<string, number>();
  let voxelCount = 0, triangles = 0, skinDropped = 0;

  // --- 先に全部位を読む（服の外径を決めてから肌を間引くため2段構え）---
  type Loaded = {
    part: { prefix: string; grid: string; weights?: string };
    grid: PartGrid; w: PartWeights | null;
    chunks: { ch: VoxChunk; voxels: Uint8Array[]; palette: number[][] }[];
  };
  const loaded: Loaded[] = [];
  for (const part of manifest.parts) {
    const grid = await get<PartGrid>(part.grid);
    const w = part.weights ? await get<PartWeights>(part.weights).catch(() => null) : null;
    const chunkDefs = grid.chunks?.length ? grid.chunks
      : [{ vox_file: `${part.prefix}.vox`, grid_origin: grid.grid_origin } as VoxChunk];
    const chunks: Loaded["chunks"] = [];
    for (const ch of chunkDefs) {
      const res = await fetch(`${baseUrl}/${ch.vox_file}`);
      if (!res.ok) continue;
      const { voxels, palette } = parseVox(await res.arrayBuffer());
      chunks.push({ ch, voxels, palette });
    }
    loaded.push({ part, grid, w, chunks });
  }

  // --- 服の外径を測る（Blender 座標のまま。x=左右 / y=前後 / z=高さ）---
  const clothPts: { x: number; y: number; z: number }[] = [];
  let clothLayer = 0.02;
  for (const L of loaded) {
    if (!CLOTH_PARTS.has(L.part.prefix)) continue;
    clothLayer = Math.max(clothLayer, L.grid.voxel_size * 2);
    for (const { ch, voxels } of L.chunks) {
      for (const v of voxels) {
        clothPts.push({
          x: ch.grid_origin[0] + (v[0] + 0.5) * L.grid.voxel_size,
          y: ch.grid_origin[1] + (v[1] + 0.5) * L.grid.voxel_size,
          z: ch.grid_origin[2] + (v[2] + 0.5) * L.grid.voxel_size,
        });
      }
    }
  }
  const covered = clothPts.length ? clothCover(clothPts, clothLayer) : null;

  // --- 髪ごとの「外径」と色（頭皮を塗るのに使う）---
  type Cover = (x: number, y: number, z: number, margin: number) => boolean;
  const hairCover = new Map<string, Cover>();
  const hairColor = new Map<string, number[]>();
  const hairVoxel = new Map<string, number>();
  for (const L of loaded) {
    if (!isHairPart(L.part.prefix)) continue;
    const pts: { x: number; y: number; z: number }[] = [];
    let color: number[] | null = null;
    for (const { ch, voxels, palette } of L.chunks) {
      for (const v of voxels) {
        pts.push({
          x: ch.grid_origin[0] + (v[0] + 0.5) * L.grid.voxel_size,
          y: ch.grid_origin[1] + (v[1] + 0.5) * L.grid.voxel_size,
          z: ch.grid_origin[2] + (v[2] + 0.5) * L.grid.voxel_size,
        });
        if (!color) color = palette[v[3] - 1] ?? null;
      }
    }
    if (!pts.length) continue;
    hairCover.set(L.part.prefix, clothCover(pts, Math.max(0.02, L.grid.voxel_size * 2)));
    hairColor.set(L.part.prefix, color ?? [60, 45, 35]);
    hairVoxel.set(L.part.prefix, L.grid.voxel_size);
  }
  /** body のボクセルごとの色バッファ上の範囲（頭皮を塗り替えるため）。 */
  const bodyVox: { x: number; y: number; z: number; s: number; e: number }[] = [];
  let bodyMesh: Mesh | null = null;
  let bodyCol: number[] = [];

  for (const { part, grid, w, chunks: loadedChunks } of loaded) {
    const chunks = loadedChunks.map((c) => c.ch);
    const S = grid.voxel_size;
    // 服の中に隠れる肌は描かない（body だけが対象。服・髪・目はそのまま）
    const cullSkin = covered && part.prefix === "body";
    const isBody = part.prefix === "body";

    // 部位の格子で「そこにボクセルがあるか」を引けるようにする（隠れた面を描かないため）
    type Cell = { c: [number, number, number]; col: number[]; wi: number };
    const cells: Cell[] = [];
    const occupied = new Set<number>();
    const KEY = (x: number, y: number, z: number): number => (x + 512) * 4194304 + (y + 512) * 2048 + (z + 512);
    let wi = 0;
    for (const { ch, voxels, palette } of loadedChunks) {
      const off = [0, 1, 2].map((i) => Math.round((ch.grid_origin[i] - grid.grid_origin[i]) / S));
      for (const v of voxels) {
        const c: [number, number, number] = [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
        const myWi = wi++;
        if (cullSkin) {
          const wx = ch.grid_origin[0] + (v[0] + 0.5) * S;
          const wy = ch.grid_origin[1] + (v[1] + 0.5) * S;
          const wz = ch.grid_origin[2] + (v[2] + 0.5) * S;
          // 服より内側なら描かない。margin は服の厚みぶんの余裕（負で少し内側まで残す）
          if (covered!(wx, wy, wz, -S)) { skinDropped++; continue; }
        }
        cells.push({ c, col: palette[v[3] - 1] ?? [200, 200, 200], wi: myWi });
        occupied.add(KEY(c[0], c[1], c[2]));
      }
    }
    if (!cells.length) continue;

    const pos: number[] = [], nrm: number[] = [], col: number[] = [];
    const mIdx: number[] = [], mWgt: number[] = [], idx: number[] = [];
    const O = grid.grid_origin;

    for (const cell of cells) {
      // --- ウェイト（最大4本、標準ボーンへ寄せて合算・正規化）---
      const acc = new Map<number, number>();
      const list = w?.weights[cell.wi];
      if (list) {
        for (const [bi, ww] of list) {
          const std = standardOf(w!.bones[bi] ?? "");
          const bone = std ? index.get(std) : undefined;
          if (bone === undefined || !(ww > 0)) continue;
          acc.set(bone, (acc.get(bone) ?? 0) + ww);
          if (std) perBone.set(std, (perBone.get(std) ?? 0) + 0);
        }
      }
      let top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (!top.length) top = [[index.get("Hips") ?? 0, 1]];
      const sum = top.reduce((s, e) => s + e[1], 0) || 1;
      const bi4 = [0, 0, 0, 0], bw4 = [0, 0, 0, 0];
      top.forEach((e, i) => { bi4[i] = e[0]; bw4[i] = e[1] / sum; });
      // 目安表示用: 一番強い骨で数える
      const domName = [...index].find(([, v]) => v === bi4[0])?.[0];
      if (domName) perBone.set(domName, (perBone.get(domName) ?? 0) + 1);

      // --- 露出面だけ張る ---
      const colStart = col.length;
      const [cx, cy, cz] = cell.c;
      const wx = O[0] + (cx + 0.5) * S, wy = O[1] + (cy + 0.5) * S, wz = O[2] + (cz + 0.5) * S;
      for (const f of FACES) {
        if (occupied.has(KEY(cx + f.d[0], cy + f.d[1], cz + f.d[2]))) continue;
        const base = pos.length / 3;
        for (const q of f.q) {
          const [px, py, pz] = toBabylon(wx + q[0] * S, wy + q[1] * S, wz + q[2] * S);
          pos.push(px, py, pz);
          const [nx, ny, nz] = toBabylon(f.n[0], f.n[1], f.n[2]);
          nrm.push(nx, ny, nz);
          col.push(cell.col[0] / 255, cell.col[1] / 255, cell.col[2] / 255, 1);
          mIdx.push(bi4[0], bi4[1], bi4[2], bi4[3]);
          mWgt.push(bw4[0], bw4[1], bw4[2], bw4[3]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        triangles += 2;
      }
      if (isBody && col.length > colStart) bodyVox.push({ x: wx, y: wy, z: wz, s: colStart, e: col.length });
      voxelCount++;
    }

    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.colors = col;
    vd.indices = idx;
    vd.matricesIndices = mIdx;
    vd.matricesWeights = mWgt;
    const mesh = new Mesh(`raw_${part.prefix}`, scene);
    // ⚠️ body だけ updatable。頭皮の色を髪型に合わせて後から書き換えるため。
    vd.applyToMesh(mesh, isBody);
    mesh.material = mat;
    mesh.parent = root;
    mesh.skeleton = skel;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;
    meshes.push(mesh);
    byPart.set(part.prefix, mesh);
    if (isBody) { bodyMesh = mesh; bodyCol = col; }
  }

  // --- 髪の下の頭皮を髪色で塗る ---
  // ⚠️ 顔（目・鼻・口）は塗らない。前髪のある髪型だと方位判定が顔まで覆ってしまい、
  //    顔が髪色に染まる。頭頂から 9cm より下の前面は対象外にする。
  const headTop = bodyVox.reduce((m, v) => Math.max(m, v.z), 0);
  const faceZ = headTop - 0.09;
  const applyScalpTint = (name: string): number => {
    if (!bodyMesh || !bodyCol.length) return 0;
    const cover = hairCover.get(name);
    const hc = hairColor.get(name);
    const cols = bodyCol.slice();
    let n = 0;
    if (cover && hc) {
      const margin = -(hairVoxel.get(name) ?? 0.005);
      const [r, g, b] = [hc[0] / 255, hc[1] / 255, hc[2] / 255];
      for (const v of bodyVox) {
        if (v.y < -0.01 && v.z < faceZ) continue;
        if (!cover(v.x, v.y, v.z, margin)) continue;
        for (let i = v.s; i < v.e; i += 4) { cols[i] = r; cols[i + 1] = g; cols[i + 2] = b; }
        n++;
      }
    }
    bodyMesh.updateVerticesData(VertexBuffer.ColorKind, cols);
    return n;
  };

  return {
    rig, root, skel, meshes, byPart, voxelCount, triangles, height, perBone, skinDropped,
    applyScalpTint,
  };
}
