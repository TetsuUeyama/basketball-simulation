// voxel-pipeline の出力（.vox + grid.json + weights.json + skeleton.json）を**そのまま**描き、
// **モデル自身のスケルトン**でモーションを当てる。
//
// ゲーム用の焼き込み（body-*.json）は通さない。あれは 15mm へのダウンサンプル、
// 15部位への分割、キットの単色塗り替えという「今のゲームのモデル体系のルール」を
// かけるので、モデルの正確さを見るのには使えない。
//
// 仕組み:
//   1. skeleton.json（モデル自身の 52 骨）の rest 位置を標準ボーン名へ読み替えて RestPose を作る
//   2. buildRig でリグを組む（＝モーションクリップが当てられる形）
//   3. weights.json の**支配ボーン**で生ボクセルを標準ボーンごとに束ね、
//      その骨のノードへ相対座標で thin instance として貼る
//   4. applyMotion でリグを動かせば、貼ったボクセルがついてくる
import {
  Mesh, MeshBuilder, Scene, StandardMaterial, Color3, Matrix, Vector3, TransformNode,
} from "@babylonjs/core";
import { buildRig, type RigHandle } from "@objcts/player/rig";
import { restPoseFrom } from "@objcts/player/restPose";
import { MIXAMO_NO_PREFIX } from "@objcts/player/presets";
import type { StandardBoneName } from "@objcts/player/standardSkeleton";

export interface VoxChunk {
  vox_file: string;
  grid_origin: [number, number, number];
  gx: number; gy: number; gz: number;
  voxel_count: number;
}
export interface PartGrid {
  voxel_size: number;
  grid_origin: [number, number, number];
  gx: number; gy: number; gz: number;
  chunks?: VoxChunk[];
}
interface PartWeights { bones: string[]; weights: [number, number][][] }
interface SkeletonJson { bones: { name: string; head_rest: number[]; parent?: string | null }[] }

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
  const rest = b.slice(5);
  if (/^Hand/i.test(rest)) return `${s}Hand` as StandardBoneName;          // 指も手へ
  if (/^Shoulder$/i.test(rest)) return `${s}Shoulder` as StandardBoneName;
  if (/^ForeArm/i.test(rest)) return `${s}LowerArm` as StandardBoneName;
  if (/^Arm$/i.test(rest)) return `${s}UpperArm` as StandardBoneName;
  if (/^UpLeg$/i.test(rest)) return `${s}UpperLeg` as StandardBoneName;
  if (/^Leg$/i.test(rest)) return `${s}LowerLeg` as StandardBoneName;
  if (/^(Foot|ToeBase|Toe_End)/i.test(rest)) return `${s}Foot` as StandardBoneName;
  return null;
}

export interface RawModel {
  rig: RigHandle;
  root: TransformNode;
  meshes: Mesh[];
  voxelCount: number;
  height: number;
  /** 骨ごとのボクセル数（貼り付け結果の確認用）。 */
  perBone: Map<string, number>;
}

/**
 * 生の出力を読み込み、モデル自身のスケルトンに貼り付けて返す。
 * `applyMotion(model.rig, clip, t)` でそのまま動く。
 */
export async function buildRawModel(scene: Scene, baseUrl: string): Promise<RawModel> {
  const get = async <T>(f: string): Promise<T> => (await fetch(`${baseUrl}/${f}`)).json() as Promise<T>;
  const manifest = await get<{ parts: { prefix: string; grid: string; weights?: string }[] }>("manifest.json");
  const skel = await get<SkeletonJson>("skeleton.json");
  const rootGrid = await get<{ bb_min: number[]; bb_max: number[] }>("grid.json");
  const height = rootGrid.bb_max[2] - rootGrid.bb_min[2];

  // --- 1. モデル自身の rest 位置 → 標準ボーン名の RestPose ---
  const src: Record<string, [number, number, number]> = {};
  for (const b of skel.bones) {
    const [x, y, z] = toBabylon(b.head_rest[0], b.head_rest[1], b.head_rest[2]);
    src[b.name] = [x, y, z];
  }
  const rest = restPoseFrom(src, MIXAMO_NO_PREFIX, "left", height);
  const root = new TransformNode("rawRoot", scene);
  const rig = buildRig(scene, rest, { name: "raw", parent: root, allowMissing: true });

  // --- 2. 生ボクセルを支配ボーンごとに束ねる ---
  const groups = new Map<StandardBoneName, { m: number[]; c: number[] }>();
  const perBone = new Map<string, number>();
  let total = 0;
  let voxelSize = 0;

  for (const part of manifest.parts) {
    const grid = await get<PartGrid>(part.grid);
    voxelSize = Math.max(voxelSize, grid.voxel_size);
    const w = part.weights ? await get<PartWeights>(part.weights) : null;
    const chunks = grid.chunks?.length ? grid.chunks
      : [{ vox_file: `${part.prefix}.vox`, grid_origin: grid.grid_origin } as VoxChunk];
    const S = grid.voxel_size;
    let wi = 0;
    for (const ch of chunks) {
      const res = await fetch(`${baseUrl}/${ch.vox_file}`);
      if (!res.ok) continue;
      const { voxels, palette } = parseVox(await res.arrayBuffer());
      for (const v of voxels) {
        // 支配ボーン（重みが最大のもの）を選ぶ。weights はチャンクをまたいで連番。
        let bone: StandardBoneName | null = null;
        const list = w?.weights[wi];
        if (list && list.length) {
          let best = list[0];
          for (const e of list) if (e[1] > best[1]) best = e;
          bone = standardOf(w!.bones[best[0]] ?? "");
        }
        wi++;
        if (!bone) bone = "Hips";
        const node = rig.node(bone);
        if (!node) continue;
        const p0 = rig.restPosition(bone);
        if (!p0) continue;
        const [px, py, pz] = toBabylon(
          ch.grid_origin[0] + (v[0] + 0.5) * S,
          ch.grid_origin[1] + (v[1] + 0.5) * S,
          ch.grid_origin[2] + (v[2] + 0.5) * S);
        let g = groups.get(bone);
        if (!g) { g = { m: [], c: [] }; groups.set(bone, g); }
        // 骨のノードからの相対位置で置く（ノードが回れば一緒に回る）
        const mtx = Matrix.Translation(px - p0.x, py - p0.y, pz - p0.z);
        for (let i = 0; i < 16; i++) g.m.push(mtx.m[i]);
        const col = palette[v[3] - 1] ?? [200, 200, 200];
        g.c.push(col[0] / 255, col[1] / 255, col[2] / 255, 1);
        perBone.set(bone, (perBone.get(bone) ?? 0) + 1);
        total++;
      }
    }
  }

  // --- 3. 骨ごとに1メッシュ（thin instance） ---
  const meshes: Mesh[] = [];
  for (const [bone, g] of groups) {
    const node = rig.node(bone);
    if (!node || !g.m.length) continue;
    const cube = MeshBuilder.CreateBox(`raw_${bone}`, { size: voxelSize }, scene);
    const mat = new StandardMaterial(`rawMat_${bone}`, scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    cube.material = mat;
    cube.parent = node;
    cube.thinInstanceSetBuffer("matrix", new Float32Array(g.m), 16, true);
    cube.thinInstanceSetBuffer("color", new Float32Array(g.c), 4, true);
    cube.alwaysSelectAsActiveMesh = true;
    meshes.push(cube);
  }

  return { rig, root, meshes, voxelCount: total, height, perBone };
}
