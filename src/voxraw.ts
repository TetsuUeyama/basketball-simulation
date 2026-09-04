// voxel-pipeline の出力（.vox + grid.json）を**そのまま**読んで描く。
//
// ゲーム用に焼いた `body-*.json` は、ゲームのモデル体系に合わせて
//   ・1.5cm へダウンサンプル（ユニフォームは元 2.5mm なので 6倍粗くなる）
//   ・部位ごとの剛体メッシュへ分割し、骨が真下を向く向きへ揃える
//   ・色をパレットの「役割」に畳んで、描画時にチームカラーで塗り替える
// という加工を通す。**モデルが正確にボクセル化できているかの確認には使えない。**
// ここはパイプラインの生の出力を、解像度も色もそのまま出す。
import { Mesh, MeshBuilder, Scene, StandardMaterial, Color3, Matrix, Vector3 } from "@babylonjs/core";

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
  scale_factor?: number;
  parent_voxel_size?: number;
  chunks?: VoxChunk[];
}

/** MagicaVoxel .vox → { voxels: [x,y,z,colorIndex][], palette: [r,g,b][] }。 */
export function parseVox(buf: ArrayBuffer): { voxels: Uint8Array[]; palette: number[][] } {
  const b = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const voxels: Uint8Array[] = [];
  let palette: number[][] | null = null;
  let p = 8;   // "VOX " + version
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
  // 既定パレット（RGBA チャンクが無い .vox 用）。ここでは灰色一色で代用する。
  return { voxels, palette: palette ?? Array.from({ length: 256 }, () => [180, 180, 180]) };
}

/**
 * Blender(Z-up, 右手) の座標を Babylon(Y-up) へ。objcts の焼き込みと同じ規約:
 *   (x, y, z) → (-x, z, -y)
 */
export const toBabylon = (x: number, y: number, z: number): [number, number, number] => [-x, z, -y];

export interface RawPart {
  name: string;
  mesh: Mesh;
  voxelCount: number;
  voxelSize: number;
}

/**
 * 1パーツ（複数チャンク）を thin instance のキューブ群として描く。
 * 生の解像度・生の色のまま出す（役割への畳み込みも塗り替えもしない）。
 */
export async function buildRawPart(
  scene: Scene, baseUrl: string, name: string, grid: PartGrid,
): Promise<RawPart | null> {
  const chunks: VoxChunk[] = grid.chunks?.length
    ? grid.chunks
    : [{ vox_file: `${name}.vox`, grid_origin: grid.grid_origin, gx: grid.gx, gy: grid.gy, gz: grid.gz, voxel_count: 0 }];

  const S = grid.voxel_size;
  const mats: number[] = [];
  const cols: number[] = [];
  let total = 0;

  for (const ch of chunks) {
    const res = await fetch(`${baseUrl}/${ch.vox_file}`);
    if (!res.ok) continue;
    const { voxels, palette } = parseVox(await res.arrayBuffer());
    const [ox, oy, oz] = ch.grid_origin;
    for (const v of voxels) {
      // .vox は原点がチャンクの角。セル中心へ +0.5 する。
      const bx = ox + (v[0] + 0.5) * S;
      const by = oy + (v[1] + 0.5) * S;
      const bz = oz + (v[2] + 0.5) * S;
      const [px, py, pz] = toBabylon(bx, by, bz);
      const m = Matrix.Translation(px, py, pz);
      for (let i = 0; i < 16; i++) mats.push(m.m[i]);
      const c = palette[v[3] - 1] ?? [200, 200, 200];
      cols.push(c[0] / 255, c[1] / 255, c[2] / 255, 1);
      total++;
    }
  }
  if (!total) return null;

  const cube = MeshBuilder.CreateBox(`raw_${name}`, { size: S }, scene);
  const mat = new StandardMaterial(`rawMat_${name}`, scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.06, 0.06, 0.06);
  cube.material = mat;
  cube.thinInstanceSetBuffer("matrix", new Float32Array(mats), 16, true);
  cube.thinInstanceSetBuffer("color", new Float32Array(cols), 4, true);
  cube.alwaysSelectAsActiveMesh = true;
  return { name, mesh: cube, voxelCount: total, voxelSize: S };
}

/** manifest.json の parts を全部読み込む。 */
export async function buildRawModel(
  scene: Scene, baseUrl: string,
): Promise<{ parts: RawPart[]; center: Vector3; height: number }> {
  const manifest = await (await fetch(`${baseUrl}/manifest.json`)).json() as
    { parts: { prefix: string; grid: string }[] };
  const parts: RawPart[] = [];
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of manifest.parts) {
    const grid = await (await fetch(`${baseUrl}/${p.grid}`)).json() as PartGrid;
    const built = await buildRawPart(scene, baseUrl, p.prefix, grid);
    if (!built) continue;
    parts.push(built);
    const bi = built.mesh.getBoundingInfo().boundingBox;
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], bi.minimumWorld.asArray()[i]);
      hi[i] = Math.max(hi[i], bi.maximumWorld.asArray()[i]);
    }
  }
  // thin instance の境界は個々の行列を見ないので、grid.json から全体の高さを取る
  const root = await (await fetch(`${baseUrl}/grid.json`)).json() as
    { bb_min: number[]; bb_max: number[] };
  const height = root.bb_max[2] - root.bb_min[2];
  return { parts, center: new Vector3(0, height / 2, 0), height };
}
