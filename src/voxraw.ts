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
  Bone, Color4, Matrix, Mesh, Scene, Skeleton, StandardMaterial, TransformNode,
  Vector3, VertexData,
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

export interface RawModel {
  rig: RigHandle;
  root: TransformNode;
  skel: Skeleton;
  meshes: Mesh[];
  voxelCount: number;
  triangles: number;
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
  mat.specularColor = new Vector3(0.05, 0.05, 0.05) as unknown as StandardMaterial["specularColor"];

  const meshes: Mesh[] = [];
  const perBone = new Map<string, number>();
  let voxelCount = 0, triangles = 0;

  for (const part of manifest.parts) {
    const grid = await get<PartGrid>(part.grid);
    const w = part.weights ? await get<PartWeights>(part.weights).catch(() => null) : null;
    const chunks = grid.chunks?.length ? grid.chunks
      : [{ vox_file: `${part.prefix}.vox`, grid_origin: grid.grid_origin } as VoxChunk];
    const S = grid.voxel_size;

    // 部位の格子で「そこにボクセルがあるか」を引けるようにする（隠れた面を描かないため）
    type Cell = { c: [number, number, number]; col: number[]; wi: number };
    const cells: Cell[] = [];
    const occupied = new Set<number>();
    const KEY = (x: number, y: number, z: number): number => (x + 512) * 4194304 + (y + 512) * 2048 + (z + 512);
    let wi = 0;
    for (const ch of chunks) {
      const res = await fetch(`${baseUrl}/${ch.vox_file}`);
      if (!res.ok) { continue; }
      const { voxels, palette } = parseVox(await res.arrayBuffer());
      const off = [0, 1, 2].map((i) => Math.round((ch.grid_origin[i] - grid.grid_origin[i]) / S));
      for (const v of voxels) {
        const c: [number, number, number] = [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
        cells.push({ c, col: palette[v[3] - 1] ?? [200, 200, 200], wi: wi++ });
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
    vd.applyToMesh(mesh, false);
    mesh.material = mat;
    mesh.parent = root;
    mesh.skeleton = skel;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;
    meshes.push(mesh);
  }

  void Color4;
  return { rig, root, skel, meshes, voxelCount, triangles, height, perBone };
}
