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

/** モデルの指の呼び方 → 標準名。Pinky だけ標準側の綴りが Little。 */
const FINGER_STD: Record<string, string> = {
  thumb: "Thumb", index: "Index", middle: "Middle", ring: "Ring", pinky: "Little",
};
/** 指の節番号 1..3 → 標準名の接尾辞。 */
const FINGER_SEG = ["Proximal", "Intermediate", "Distal"];

/**
 * モデルのボーン名 → 標準ボーン名。つま先は足へ寄せる。
 *
 * ⚠️ 以前は**指もすべて手へ寄せていた**（リグに指の節が無かった頃の名残）。いまの
 *    生素体には指の骨が 30 本あり、寄せたままだと指の骨をいくら回してもメッシュが
 *    まったく動かない（実測: 手のひらがどの位置でも開いたまま握らない）。
 *    節ごとの標準名へ結び直す。リグに無い節はここで null になり、ウェイトは
 *    残りの骨で正規化されるので、宙に浮くことはない。
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
  const fg = /^Hand(Thumb|Index|Middle|Ring|Pinky)([123])$/i.exec(rest);
  if (fg) {
    const std = FINGER_STD[fg[1].toLowerCase()];
    const seg = FINGER_SEG[Number(fg[2]) - 1];
    return std && seg ? (`${s}${std}${seg}` as StandardBoneName) : (`${s}Hand` as StandardBoneName);
  }
  if (/^Hand/i.test(rest)) return `${s}Hand` as StandardBoneName;
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

/** 顔（あご）のバリエーション。normal = モデルそのまま。 */
export type JawShape = "normal" | "round" | "narrow";

/** ボクセル1個ぶんの情報。格子座標・色・ウェイト表の行番号。 */
type Cell = { c: [number, number, number]; col: number[]; wi: number };
const CELL_KEY = (x: number, y: number, z: number): number =>
  (x + 512) * 4194304 + (y + 512) * 2048 + (z + 512);

/**
 * あごの変形プロファイル。t=0 が頬の高さ、t=1 が**あごの底**。
 * width = 幅(X)の倍率 / depth = 前方向(Y)の倍率（顔の前面だけに掛かる）。
 *
 * 実測（player_one）: 頬〜あごの幅が 0.166m で**ほぼ一定**。絞りが全く無く、
 * それが「四角いあご＝モアイ」の正体。
 *
 * ⚠️ 係数は「範囲サンプリング」前提。逆写像は元のセルを1点でなく**覆う範囲全部**見るので、
 *    量子化で1ボクセルぶん太る。その分を見込んで強めにしてある。
 * ⚠️ depth は t³ にしてある。顔の前面（口〜あご先の平面）は削る必要が無く、
 *    削っていいのは**あごの底**だけなので、効きを最下部へ集中させる。
 *    t² にすると顔の前が 17mm 削れて別人になった。
 */
const JAW_PROFILE: Record<Exclude<JawShape, "normal">, {
  width: (t: number) => number;
  depth: (t: number) => number;
  /** あごを縦に詰める量(m)。あご先が上がって顔が短くなる。 */
  shorten: number;
}> = {
  // 丸顔: 横を穏やかに落とし、底を丸め、いちばん短くする
  round: { width: (t) => 1 - 0.34 * Math.pow(t, 1.0), depth: (t) => 1 - 0.55 * t * t, shorten: 0.055 },
  // 細あご: 横を強く落として V ライン。短縮は控えめ
  narrow: { width: (t) => 1 - 0.85 * Math.pow(t, 0.8), depth: (t) => 1 - 0.30 * t * t, shorten: 0.012 },
};

/**
 * 表面に空いた**細い横の抜け**をボクセルで埋める。同じ (x,y) の柱で上下に肌があるのに
 * 間が maxGap 層までしか空いていなければ、近い側の色・ウェイトで埋める。
 *
 * ⚠️ maxGap を大きくすると「あごの下と首の間」のような**本来空いている空間**まで塊で
 *    埋まり、あごの下に突起ができて首を覆い隠す。縫い目（1〜2個）だけにすること。
 */
function closeSeams(
  cells: Cell[], maxGap: number, O: number[], S: number,
  inRegion: (x: number, y: number, z: number) => boolean,
): Cell[] {
  const occ = new Set<number>();
  for (const c of cells) occ.add(CELL_KEY(c.c[0], c.c[1], c.c[2]));
  // ⚠️ 対象を高さだけで切ると、肩や胸の間引かれた肌の間まで埋まって首が肩幅になる
  //    （実測: 頭頂から0.253m の幅が 0.254→0.289 に膨らんだ）。首の柱に限定する。
  const target = cells.filter((c) => inRegion(
    O[0] + (c.c[0] + 0.5) * S, O[1] + (c.c[1] + 0.5) * S, O[2] + (c.c[2] + 0.5) * S));
  const add: Cell[] = [];
  const seen = new Set<number>();
  // ⚠️ 縦だけだと側面の抜けが塞がらない（実測: 丸顔の頭頂から 0.225〜0.234m、
  //    左右の側面でレイが貫通していた）。X/Y/Z の3方向とも見る。
  //    埋めるのは既にある肌と肌の**間**だけなので、輪郭が外へ広がることはない。
  for (const axis of [0, 1, 2]) {
    const lines = new Map<number, Cell[]>();
    for (const c of target) {
      const a0 = axis === 0 ? c.c[1] : c.c[0];
      const a1 = axis === 2 ? c.c[1] : c.c[2];
      const k = (a0 + 512) * 2048 + (a1 + 512);
      let l = lines.get(k);
      if (!l) { l = []; lines.set(k, l); }
      l.push(c);
    }
    for (const l of lines.values()) {
      l.sort((x, y) => x.c[axis] - y.c[axis]);
      for (let n = 1; n < l.length; n++) {
        const lo = l[n - 1], hi = l[n];
        const gap = hi.c[axis] - lo.c[axis] - 1;
        if (gap < 1 || gap > maxGap) continue;
        for (let t = lo.c[axis] + 1; t < hi.c[axis]; t++) {
          const cc: [number, number, number] = [lo.c[0], lo.c[1], lo.c[2]];
          cc[axis] = t;
          const key = CELL_KEY(cc[0], cc[1], cc[2]);
          if (occ.has(key) || seen.has(key)) continue;
          seen.add(key);
          const src = t - lo.c[axis] <= hi.c[axis] - t ? lo : hi;
          add.push({ c: cc, col: src.col, wi: src.wi });
        }
      }
    }
  }
  return add.length ? cells.concat(add) : cells;
}

/**
 * 顔（目・口）を**描いて**顔の表面に貼る。元モデル（function-lab の buildParts.mjs
 * `splitFace`）と同じ作り:
 *   目 … 白目 3×2 マス、黒目は上段の中央1マス。左右対称に2つ。
 *   口 … 横一文字。元は 2*HW マス（HW = 頭の幅/8 ≒ 2）×厚さ1段。
 * ⚠️ ボクセルは body の**縦横半分**（body 8.74mm に対し 4.37mm）。上の枡目もそのぶん倍に
 *    なるので、白目 6×4・黒目 2×2・口 8×2 で作る。
 * ⚠️ 元データから目・口の面は取れない。実測すると顔の前面の色は肌色 70〜75 階調だけで
 *    唇も眉も残らず、眼球メッシュは瞼の内側（肌より 26mm 奥）にある。だから描くしかない。
 */
const MARK_HALF = 0.5;              // body に対するボクセル比（縦横半分）
/** 白目・黒目・唇の色（元モデルは白目=182の灰 / 黒目=2の黒）。 */
const MARK_COLOR = { white: [182, 182, 182], black: [2, 2, 2], lip: [120, 60, 50] };
/** 枡目の数（半分のボクセルでの数）。元モデルの倍。 */
// ⚠️ マスの実寸 = body のボクセル × MARK_HALF。ボクセルを粗くしたらマス数を
//    そのぶん減らさないと、顔に対して目・口だけが倍の大きさになる。
//    resolution 110(body 9.38mm) では 6×4/2/8×2 だった。55(18.75mm) はその半分。
//    実測(probe-facefit): 減らす前は 64マス中 38〜44マスが顔から外れていた。
const MARK_GRID = { eyeW: 3, eyeH: 2, pupil: 1, mouthW: 4, mouthH: 1 };
/**
 * 顔の中での位置（頭頂からの距離 m / 中心からの左右 m）。
 * 実測（player_one / 頭頂Z 1.800、Face.jpg を顔のポリゴンへサンプルして得た値）:
 *   目・眉 頭頂から 0.088〜0.117m、X -0.039〜+0.046
 *   口     頭頂から 0.146〜0.175m、X -0.025〜+0.022
 */
const MARK_POS = { eyeDepth: 0.102, eyeX: 0.032, mouthDepth: 0.172 };

/** 顔に描く1マス。Blender 座標の中心と色。 */
type Mark = { x: number; y: number; z: number; col: number[] };

/**
 * 顔の表面に目と口のマス目を並べる。`cells` は body のボクセル（Blender 格子）。
 * 戻り値は「半分の大きさの立方体」の中心と色。
 */
function faceMarks(cells: Cell[], O: number[], S: number): Mark[] {
  const H = S * MARK_HALF;
  let topZ = -Infinity;
  for (const c of cells) topZ = Math.max(topZ, O[2] + (c.c[2] + 0.5) * S);

  // 顔の前面（Blender では -Y が前）。(x, z) ごとに一番前の面の位置を持つ。
  // ⚠️ 升目は Math.round(x/S) ではなく**セル番号**で引くこと。格子の原点は S の倍数では
  //    ないので、丸めだと升目がずれて隣のセルを見る。実測で 64 マス中 14 マスが
  //    肌より 9.8mm 奥（＝完全に埋没）に置かれていた。
  const front = new Map<number, number>();
  const cellX = (x: number): number => Math.floor((x - O[0]) / S);
  const cellZ = (z: number): number => Math.floor((z - O[2]) / S);
  const key = (ix: number, iz: number): number => (ix + 512) * 2048 + (iz + 512);
  for (const c of cells) {
    const x = O[0] + (c.c[0] + 0.5) * S, y = O[1] + (c.c[1] + 0.5) * S, z = O[2] + (c.c[2] + 0.5) * S;
    if (topZ - z > 0.24 || Math.abs(x) > 0.12) continue;
    const k = key(c.c[0], c.c[2]);
    const cur = front.get(k);
    if (cur === undefined || y < cur) front.set(k, y);
  }
  /**
   * (x, z) の肌の表面 Y。
   * ⚠️ 周り1マスの中で一番手前を採ると、顔の曲面では実際の面より前に出て**浮く**。
   *    まずその位置ちょうどを見て、そこに肌が無いときだけ周りへ広げる。
   */
  const surfaceY = (x: number, z: number): number | null => {
    const ix = cellX(x), iz = cellZ(z);
    const hit = front.get(key(ix, iz));
    if (hit !== undefined) return hit - S / 2;   // ボクセル中心 → 前面
    // ⚠️ ここで周囲の**一番手前**を採ると、肌の無い場所で前へ出過ぎて浮く（実測5マス）。
    //    一番奥を採る。少し食い込む側に倒れるだけで、浮きは出ない。
    let best: number | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const v = front.get(key(ix + dx, iz + dz));
        if (v !== undefined && (best === null || v > best)) best = v;
      }
    }
    return best === null ? null : best - S / 2;
  };

  const out: Mark[] = [];
  /** 左上を (cx, cz) 中心とする w×h の枡目を顔に貼る。 */
  const block = (cx: number, cz: number, w: number, h: number,
    color: (col: number, row: number) => number[]): void => {
    for (let col = 0; col < w; col++) {
      for (let row = 0; row < h; row++) {
        const x = cx + (col - (w - 1) / 2) * H;
        const z = cz - (row - (h - 1) / 2) * H;
        const sy = surfaceY(x, z);
        if (sy === null) continue;
        // ⚠️ 面のちょうど外側に置くと隙間ができて浮いて見える。1/4マスだけ肌へ食い込ませる。
        out.push({ x, y: sy - H * 0.25, z, col: color(col, row) });
      }
    }
  };

  const eyeZ = topZ - MARK_POS.eyeDepth;
  const { eyeW, eyeH, pupil, mouthW, mouthH } = MARK_GRID;
  const p0 = Math.floor((eyeW - pupil) / 2);       // 黒目は上段の中央
  for (const sx of [-1, 1]) {
    block(sx * MARK_POS.eyeX, eyeZ, eyeW, eyeH,
      (col, row) => (row < pupil && col >= p0 && col < p0 + pupil
        ? MARK_COLOR.black : MARK_COLOR.white));
  }
  block(0, topZ - MARK_POS.mouthDepth, mouthW, mouthH, () => MARK_COLOR.lip);
  return out;
}

/**
 * あごだけを作り替える。頭の軸まわりに、高さに応じて幅と奥行きを縮める。
 *
 * ⚠️ 位置をずらすのではなく**逆写像でサンプリングし直す**（変形後の格子から元の格子を引く）。
 *    ボクセルを個別に動かすと、隣どうしの移動量の差が隙間になって関節と同じ割れ方をする。
 *    逆写像なら結果は必ず格子に載るので割れない。
 * ⚠️ 後頭部と首の後ろは触らない（顔の側面〜前面だけ）。
 * ⚠️ 帯は**あごの底まで**伸ばし、下端で強さを戻さない。以前は下端手前で 0 に戻していたため、
 *    実測で頭頂から 0.227m 以下が変化 0% ＝「下だけモアイのまま」になっていた。
 *    帯の下は首（もともと細い）なので、段差にはならない。
 */
/**
 * 体から求めた「あごを作り替えるための頭の情報」。
 * ⚠️ 髭のある髪型（実測 139 件中 67 件）にも同じ変形を掛けるので、頭の中心や頭頂は
 *    **体から**求めて渡すこと。髪型自身のボクセルから求めると、髭だけの範囲で
 *    中心を取ってしまい、体と違う変形になって顔からずれる。
 */
type JawFit = { topZ: number; cx: number; cy: number; backY: number };

/** body のボクセルから JawFit を作る。 */
function jawFitFrom(cells: Cell[], O: number[], S: number): JawFit | null {
  const wx = (i: number): number => O[0] + (i + 0.5) * S;
  const wy = (j: number): number => O[1] + (j + 0.5) * S;
  const wz = (k: number): number => O[2] + (k + 0.5) * S;
  let topZ = -Infinity;
  for (const c of cells) topZ = Math.max(topZ, wz(c.c[2]));
  const jawTop = topZ - 0.130, jawBottom = topZ - 0.265;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, backY = -Infinity;
  for (const c of cells) {
    const z = wz(c.c[2]);
    if (z < jawBottom || z > jawTop) continue;
    const x = wx(c.c[0]), y = wy(c.c[1]);
    if (Math.abs(x) > 0.16) continue;      // 腕・肩を除く
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    backY = Math.max(backY, y);
  }
  if (!isFinite(minX)) return null;
  return { topZ, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, backY };
}

function reshapeJaw(
  cells: Cell[], O: number[], S: number, shape: Exclude<JawShape, "normal">,
  fit: JawFit, forBody: boolean,
): Cell[] {
  const P = JAW_PROFILE[shape];
  const wx = (i: number): number => O[0] + (i + 0.5) * S;
  const wy = (j: number): number => O[1] + (j + 0.5) * S;
  const wz = (k: number): number => O[2] + (k + 0.5) * S;

  const topZ = fit.topZ;
  // 実測（頭頂Z1.802 / 服に隠れた肌を除いたメッシュ）: 頭頂から
  //   0.131〜0.236m … 幅 0.184→0.140 でほぼ一定＝あご（ここを削る）
  //   0.245m 以降  … 幅 0.096 の首（触らない）
  // ⚠️ jawBottom を 0.240 にしていたら、その下に残るあご先（前方へ 0.096 まで
  //    突き出す刃状の部分。実測で 0.255 付近まで続く）が変形対象外で残り、
  //    丸顔・細あごにしても「あごの下に突起」として見えていた。刃の下まで帯を伸ばす。
  const jawTop = topZ - 0.130, jawBottom = topZ - 0.265;
  /** これより下は首。横を削らずに守る（削ると首がくびれる）。 */
  const neckTop = topZ - 0.235;

  // 作り直す窓は**この部位自身**のセルから取る（髭は顔の前面にしか無い）。
  // ⚠️ ここで |x| を絞らずに窓を取ると、窓が腕・肩まで広がる。窓の中の元セルは下で
  //    消すので、T-pose の腕（|x| 最大 0.9）が丸ごと消えた。頭・首の柱だけにすること。
  const { cx, cy } = fit;
  let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
  for (const c of cells) {
    const z = wz(c.c[2]);
    if (z < jawBottom || z > jawTop) continue;
    if (Math.abs(wx(c.c[0])) > 0.16) continue;
    iMin = Math.min(iMin, c.c[0]); iMax = Math.max(iMax, c.c[0]);
    jMin = Math.min(jMin, c.c[1]); jMax = Math.max(jMax, c.c[1]);
  }
  if (!isFinite(iMin)) return cells;

  const smooth = (u: number): number => {
    const v = u < 0 ? 0 : (u > 1 ? 1 : u);
    return v * v * (3 - 2 * v);
  };
/**
   * 高さ z での変形の強さ。頬の高さで0、あごの底で1。
   * ⚠️ 引数には**元の高さ**（縦に詰める前）を渡すこと。首の材料（jawBottom より下）は
   *    0 になり、細らせない。
   */
  const strength = (z: number): number => {
    if (z >= jawTop || z < jawBottom) return 0;
    return smooth((jawTop - z) / (jawTop - jawBottom));
  };

  /**
   * 縦に詰める写像。あご帯の材料を shorten だけ上へ寄せる＝あご先が上がって顔が短くなる。
   *
   * ⚠️ 空いた下は「あごの底より下の材料」＝首で埋まる。実測すると**見えている首は
   *    13mm しかない**（頭頂から 0.253m 以下はユニフォームに隠れて肌が無い）ので、
   *    足りない分は最下層の断面を複製する（kLow でクランプ）。
   *    これをやらないと、上がったあごと首の間に穴が空く。
   */
  const shorten = P.shorten;
  const liftAt = (z: number): number => {
    if (z >= jawTop || z < jawBottom) return 0;
    return smooth((jawTop - z) / (jawTop - jawBottom));
  };
  /**
   * 顔の前面〜側面なら1、首の後ろなら0。
   *
   * ⚠️ 最初これを「中心より前だけ」にしたら幅が全く変わらなかった。実測すると、
   *    あご帯で最も幅が広いボクセルは Y=0.022〜0.083、つまり**顔の中心より後ろ**
   *    （耳〜えらの高さ）にある。守りたいのは首の後ろだけなので、帯の後端から
   *    4.5cm ぶんだけ効果を落とす。
   */
  const backY = fit.backY;
  const frontness = (y: number): number => smooth((backY - 0.006 - y) / 0.045);

  const srcMap = new Map<number, Cell>();
  for (const c of cells) srcMap.set(CELL_KEY(c.c[0], c.c[1], c.c[2]), c);

  // ⚠️ floor だと中心が jawBottom より下の層まで拾い、そこも strength=1 で削れる。
  //    実測で首が 18〜36% 細くなった。切り上げて帯の中の層だけにする。
  const kFrom = Math.ceil((jawBottom - O[2]) / S - 0.5);
  const kTo = Math.ceil((jawTop - O[2]) / S - 0.5);
  const iLo = iMin - 2, iHi = iMax + 2, jLo = jMin - 2, jHi = jMax + 2;
  // 窓（高さ＋前後左右）の中だけを作り直す。外は元のまま＝腕は消えない。
  const out = cells.filter((c) => !(
    c.c[2] >= kFrom && c.c[2] <= kTo
    && c.c[0] >= iLo && c.c[0] <= iHi && c.c[1] >= jLo && c.c[1] <= jHi));
  for (let k = kFrom; k <= kTo; k++) {
    // 縦に詰める: この高さに出す材料は、元は shorten * liftAt ぶん下にあったもの
    const zTgt = wz(k);
    const zSrc = zTgt - shorten * liftAt(zTgt);
    // ⚠️ 持ち上げ元をここより下へ行かせない。首の下側は服の中に隠れた**肩に近い太い肌**
    //    （実測 頭頂から0.250m で幅0.256m）で、そのまま持ち上げるとあごの底が標準より
    //    42%太くなった。細い首が残っている高さで止める。
    const kFloor = Math.ceil((topZ - 0.245 - O[2]) / S - 0.5);
    const HZ = S * 0.49;
    const zSrcA = (zTgt - HZ) - shorten * liftAt(zTgt - HZ);
    const zSrcB = (zTgt + HZ) - shorten * liftAt(zTgt + HZ);
    const ksLo = Math.max(kFloor, Math.round((Math.min(zSrcA, zSrcB) - O[2]) / S - 0.5));
    const ksHi = Math.max(ksLo, Math.round((Math.max(zSrcA, zSrcB) - O[2]) / S - 0.5));
    void zSrc;
    // ⚠️ 削り具合は**出す先の高さ**で決める。元の高さで決めると、下から持ち上げた
    //    あご先が「首の材料」と判定されて削られず、突起として残る。
    const t = strength(zTgt);
    for (let j = jLo; j <= jHi; j++) {
      const y = wy(j);
      // 首の高さでは首の柱を削らない（削ると首がくびれる）
      const guard = zTgt >= neckTop || y <= -0.065 || y >= 0.075
        ? 1 : 1 - smooth((neckTop - zTgt) / 0.025);
      // 前面だけ奥行きを変える（後ろは首なので触らない）
      const dep = y < cy ? 1 + (P.depth(t) - 1) * guard : 1;
      // ⚠️ 逆写像で元のボクセルを**1点だけ**引くと、縮小率 0.8 のとき元の格子を
      //    1.25 個おきに飛ばして拾うことになり、薄い表面が抜けて穴が開く。
      //    実測: 丸顔で Blender Y=0 の面が丸ごと消え、左右からレイが貫通していた。
      //    このセルが覆う範囲（±半ボクセル）を写した先を全部見る。
      // ⚠️ 半ボクセルちょうどにすると、倍率1.0（変形なし）でも範囲の端が格子の境界に
      //    乗って隣のセルまで拾い、あご帯の上端で1ボクセル膨らむ。実測でそれが
      //    目の高さの横線状の段差になっていた。ほんの少し内側にする。
      const H = S * 0.49;
      const syA = y - H < cy ? cy + (y - H - cy) / dep : y - H;
      const syB = y + H < cy ? cy + (y + H - cy) / dep : y + H;
      const sjLo = Math.round((Math.min(syA, syB) - O[1]) / S - 0.5);
      const sjHi = Math.round((Math.max(syA, syB) - O[1]) / S - 0.5);
      const f = frontness(y);
      for (let i = iLo; i <= iHi; i++) {
        const x = wx(i);
        const wid = 1 + (P.width(t) - 1) * f * guard;
        const sxA = cx + (x - H - cx) / wid, sxB = cx + (x + H - cx) / wid;
        const siLo = Math.round((Math.min(sxA, sxB) - O[0]) / S - 0.5);
        const siHi = Math.round((Math.max(sxA, sxB) - O[0]) / S - 0.5);
        let c: Cell | undefined;
        for (let sj2 = sjLo; sj2 <= sjHi && !c; sj2++) {
          for (let si2 = siLo; si2 <= siHi && !c; si2++) {
            for (let ks2 = ksLo; ks2 <= ksHi && !c; ks2++) c = srcMap.get(CELL_KEY(si2, sj2, ks2));
          }
        }
        if (c) out.push({ c: [i, j, k], col: c.col, wi: c.wi });
      }
    }
  }
  // ⚠️ ここから先（首の輪郭クリップ・隙間埋め）は body 専用。髪や髭に掛けると、
  //    首の footprint の外にある髭が丸ごと消える。
  if (!forBody) return out;

  // --- 仕上げ1: 顔の輪郭の外に残ったボクセルを消す ---------------------------
  // ⚠️ あごを持ち上げると、輪郭の外に取り残しが出て「あごの下に浮いたボクセル」に見える。
  //    あごより下は**首の footprint**（あごが届かない高さの (i,j) を1マス膨らませたもの）
  //    の中だけを残し、顔と首の境目をはっきりさせる。
  const FOOT = (i: number, j: number): number => (i + 512) * 2048 + (j + 512);
  const foot = new Set<number>();
  for (const c of cells) {
    const z = wz(c.c[2]);
    if (z > topZ - 0.255 || z < topZ - 0.295) continue;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) foot.add(FOOT(c.c[0] + di, c.c[1] + dj));
    }
  }
  const inWindow = (c: Cell): boolean =>
    c.c[0] >= iLo && c.c[0] <= iHi && c.c[1] >= jLo && c.c[1] <= jHi;
  // ⚠️ 高さの下限を切ること。切らずに「neckTop より下」だけで判定したら、頭の真下に
  //    ある**脚・胴の前面**まで首の footprint 外として消えた（丸顔で脚の前が消えた）。
  const clipLo = topZ - 0.30;
  const clipped = foot.size === 0 ? out : out.filter((c) => {
    const z = wz(c.c[2]);
    if (!inWindow(c) || z >= neckTop || z < clipLo) return true;
    return foot.has(FOOT(c.c[0], c.c[1]));
  });

  // --- 仕上げ2: 縦に空いた隙間を埋める ---------------------------------------
  // ⚠️ あごを持ち上げたぶん、顔の下端と首の上端の間が抜けて穴になる。
  //    同じ (i,j) の柱で上下に肌があるのに間が空いていたら、近い方の色・ウェイトで埋める。
  const MAX_GAP = 5;                       // これより広い隙間は「元から空いている場所」
  const byCol = new Map<number, Cell[]>();
  for (const c of clipped) {
    if (!inWindow(c) || c.c[2] < kFrom - 2 || c.c[2] > kTo + 2) continue;
    const k = FOOT(c.c[0], c.c[1]);
    let a = byCol.get(k);
    if (!a) { a = []; byCol.set(k, a); }
    a.push(c);
  }
  const filled: Cell[] = [];
  for (const list of byCol.values()) {
    list.sort((a, b) => a.c[2] - b.c[2]);
    for (let n = 1; n < list.length; n++) {
      const lo = list[n - 1], hi = list[n];
      const d = hi.c[2] - lo.c[2];
      if (d <= 1 || d > MAX_GAP + 1) continue;
      for (let k = lo.c[2] + 1; k < hi.c[2]; k++) {
        const src = k - lo.c[2] <= hi.c[2] - k ? lo : hi;
        filled.push({ c: [lo.c[0], lo.c[1], k], col: src.col, wi: src.wi });
      }
    }
  }
  return filled.length ? clipped.concat(filled) : clipped;
}

/**
 * 体重による厚みの基準。選手データ 4015 人の BMI は 17.0〜29.4、中央 23.1（実測）。
 * 厚み倍率 = sqrt(BMI / 23.1)。横2方向にだけ効かせるので、体積は倍率の2乗で効く。
 * 実測の範囲: BMI 17.0 → x0.859 / 23.1 → x1.000 / 29.4 → x1.128。
 */
const BMI_REF = 23.1;
/**
 * 骨ごとの効き方。1 = 厚みをそのまま、0 = 変えない。
 * ⚠️ 頭と首は変えない。太っても頭蓋骨は太らないので、変えると別人の頭になる。
 */
const THICK_BY_BONE: Record<string, number> = {
  Head: 0, Neck: 0,
  LeftShoulder: 0.6, RightShoulder: 0.6,
  LeftHand: 0.3, RightHand: 0.3, LeftFoot: 0.3, RightFoot: 0.3,
};
/** 骨の向きを出すための子ボーン。無い骨は親からの向きを使う。 */
const BONE_CHILD: Record<string, string> = {
  Hips: "Spine", Spine: "Chest", Chest: "Neck", Neck: "Head",
  LeftShoulder: "LeftUpperArm", LeftUpperArm: "LeftLowerArm", LeftLowerArm: "LeftHand",
  RightShoulder: "RightUpperArm", RightUpperArm: "RightLowerArm", RightLowerArm: "RightHand",
  LeftUpperLeg: "LeftLowerLeg", LeftLowerLeg: "LeftFoot",
  RightUpperLeg: "RightLowerLeg", RightLowerLeg: "RightFoot",
};
/** 子が無い骨の向きを出すための親。 */
const BONE_PARENT: Record<string, string> = {
  Head: "Neck", LeftHand: "LeftLowerArm", RightHand: "RightLowerArm",
  LeftFoot: "LeftLowerLeg", RightFoot: "RightLowerLeg",
};
// 指の節を3つの表へ足す。
// ⚠️ 足さないと、指だけ厚みの効き方が手と変わる（手は 0.3、既定は 1）。ウェイトを
//    手から指へ移した瞬間に、太い選手の指だけ太くなって手首で段が付く。
for (const side of ["Left", "Right"]) {
  for (const f of ["Thumb", "Index", "Middle", "Ring", "Little"]) {
    const pr = `${side}${f}Proximal`, it = `${side}${f}Intermediate`, di = `${side}${f}Distal`;
    THICK_BY_BONE[pr] = THICK_BY_BONE[it] = THICK_BY_BONE[di] = 0.3;   // 手と同じ
    BONE_CHILD[pr] = it; BONE_CHILD[it] = di;
    BONE_PARENT[di] = it;
  }
}

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
): {
  /** 服の内側に隠れているか（外殻より内側）。 */
  under: (x: number, y: number, z: number, margin: number) => boolean;
  /** 服の**最内殻より内側**か。＝襟の穴の中。ここの肌は上から見えるので残す。 */
  inHole: (x: number, y: number, z: number, margin: number) => boolean;
} {
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
  const inner = new Map<string, number>();
  const key = (L: number, s: number): string => L + "," + ((s % SECTORS) + SECTORS) % SECTORS;
  const put = (L: number, s: number, r: number): void => {
    const k = key(L, s);
    const cur = outer.get(k);
    if (cur === undefined || cur < r) outer.set(k, r);
  };
  /** 最内殻。方位は広げない（広げると襟の穴が実際より狭くなる）。 */
  const putIn = (L: number, s: number, r: number): void => {
    const k = key(L, s);
    const cur = inner.get(k);
    if (cur === undefined || cur > r) inner.set(k, r);
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
    putIn(L, s, r);
  }

  return {
    under: (x, y, z, margin) => {
      const L = Math.round(z / layer);
      const ax = axis.get(L);
      if (!ax) return false;
      const dx = x - ax[0], dy = y - ax[1];
      const o = outer.get(key(L, sectorOf(dx, dy)));
      // 服の方が外側にある = この肌は服の中に隠れている
      return o !== undefined && o > Math.hypot(dx, dy) + margin;
    },
    inHole: (x, y, z, margin) => {
      const L = Math.round(z / layer);
      const ax = axis.get(L);
      if (!ax) return false;
      const dx = x - ax[0], dy = y - ax[1];
      const i = inner.get(key(L, sectorOf(dx, dy)));
      // 服のどの面よりも内側 = 襟の穴の中。上から見えるので描く
      return i !== undefined && Math.hypot(dx, dy) + margin < i;
    },
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
  /** 殻の内側の空洞に向いていて描かなかった面の数。 */
  cavityFaces: number;
  /**
   * 遠景用の粗いメッシュを作って返す（作ってあれば使い回す）。描画は呼び手が決める。
   * ⚠️ 26人ぶんを近景の細かさで描くと三角形が桁違いになる。遠い選手はこちらへ寄せる。
   */
  lodPart(name: string): Mesh | null;
  /** 粗い版のボクセル寸法が細かい版の何倍か。 */
  lodStep: number;
  /** 背中の番号（Name ではないほう）が占めている範囲。選手ごとの番号を貼る位置。 */
  backNumberBand: { xLo: number; xHi: number; yLo: number; yHi: number } | null;
  /**
  /** あごの形を変える（顔のバリエーション）。body のメッシュだけ張り直す。 */
  setJaw(shape: JawShape): void;
  /** モデル自身の身長(cm)。足元（全部位の最下端）から頭頂（body の最上端）まで。 */
  modelHeightCm: number;
  /** 身長を変える。ボクセルは作り直さず、表示のときに伸縮する。 */
  setHeight(cm: number): void;
  /**
   * 身長と体重から体格を決める。身長は表示の伸縮、体重は骨ごとの厚みで効かせる。
   * 厚みが変わるときだけメッシュを張り直す。
   */
  setBody(heightCm: number, weightKg: number): void;
  /** いまの厚み倍率（1 = モデルのまま）。 */
  thickness: number;
  /**
   * 別のリグへ、この素体と同じ身長合わせ・肩幅合わせを掛ける。
   * ⚠️ 26人ぶんのジオメトリは1体ぶんを共有する（buildRawRig で骨だけ人数ぶん作る）。
   *    共有したジオメトリは**この素体のいまの厚みで**作られているので、複製先の骨にも
   *    同じ肩幅を入れないと、肩から先がズレる。身長は骨の伸縮では無く root の倍率で出す。
   */
  applyTo(root: TransformNode, rig: RigHandle, heightCm: number): void;
  /** 使える髪型の名前（データにあるもの全部）。メッシュはまだ作っていない。 */
  hairNames: string[];
  /** 髪型を1つ読み込んでメッシュにする。読み終えると byPart から取れる。 */
  loadHair(name: string): Promise<boolean>;
  height: number;
  perBone: Map<string, number>;
}

/**
 * 生の出力を読み込み、モデル自身のスケルトンへ**スキニングして**返す。
 * `applyMotion(model.rig, clip, t)` → `model.skel.prepare()` で変形する。
 */
/** 読み込んだ素材。1回読めば、何人ぶんでも同期で組める。 */
export interface RawSource {
  baseUrl: string;
  skelJson: SkeletonJson;
  /** grid.json の bb から出した高さ（rest を作るのに使う）。 */
  height: number;
  hairParts: { prefix: string; grid: string; weights?: string }[];
  hairNames: string[];
  parts: LoadedPart[];
  get<T>(f: string): Promise<T>;
  loadPart(part: { prefix: string; grid: string; weights?: string }): Promise<LoadedPart>;
}
/** 部位1つぶんの読み込み済みデータ。 */
export interface LoadedPart {
  part: { prefix: string; grid: string; weights?: string };
  grid: PartGrid;
  w: PartWeights | null;
  chunks: { ch: VoxChunk; voxels: Uint8Array[]; palette: number[][] }[];
}

/**
 * ボクセル素材をまとめて読む。
 * ⚠️ 差し替え用の髪型は 139 件・20MB あるので、ここでは読まない（選ばれたものだけ後で読む）。
 */
export async function preloadRawSource(baseUrl: string): Promise<RawSource> {
  // ⚠️ 404 を握り潰すと「真っ黒だが例外も出ない」になる。必ず落とす。
  const get = async <T>(f: string): Promise<T> => {
    const r = await fetch(`${baseUrl}/${f}`);
    if (!r.ok) throw new Error(`${f} が読めない (HTTP ${r.status})。scripts/sync-voxraw.mjs を流したか？`);
    return await r.json() as T;
  };
  // ⚠️ 1つずつ await で繋ぐと、部位7つで21回の往復が直列になる。ブラウザでは他の
  //    読み込みと競合して秒単位になり、選手を組む時刻に間に合わず従来モデルへ落ちた。
  //    独立した取得はまとめて投げる。
  const loadPart = async (part: LoadedPart["part"]): Promise<LoadedPart> => {
    const [grid, w] = await Promise.all([
      get<PartGrid>(part.grid),
      part.weights ? get<PartWeights>(part.weights).catch(() => null) : Promise.resolve(null),
    ]);
    const chunkDefs = grid.chunks?.length ? grid.chunks
      : [{ vox_file: `${part.prefix}.vox`, grid_origin: grid.grid_origin } as VoxChunk];
    const got = await Promise.all(chunkDefs.map(async (ch) => {
      const res = await fetch(`${baseUrl}/${ch.vox_file}`);
      if (!res.ok) return null;
      const { voxels, palette } = parseVox(await res.arrayBuffer());
      return { ch, voxels, palette };
    }));
    return { part, grid, w, chunks: got.filter((x): x is LoadedPart["chunks"][number] => !!x) };
  };
  const [manifest, skelJson, rootGrid] = await Promise.all([
    get<{ parts: { prefix: string; grid: string; weights?: string }[] }>("manifest.json"),
    get<SkeletonJson>("skeleton.json"),
    get<{ bb_min: number[]; bb_max: number[] }>("grid.json"),
  ]);
  const hairParts = manifest.parts.filter((x) => x.prefix.startsWith("hairstyle_"));
  const parts: LoadedPart[] = await Promise.all(
    manifest.parts.filter((x) => !x.prefix.startsWith("hairstyle_")).map(loadPart));
  return {
    baseUrl, skelJson, height: rootGrid.bb_max[2] - rootGrid.bb_min[2],
    hairParts, hairNames: hairParts.map((x) => x.prefix).sort(), parts, get, loadPart,
  };
}

/**
 * 素材からリグとスケルトンだけ作る。
 * ⚠️ 26人ぶんメッシュを別々に作ると重いので、ジオメトリは1体ぶんを共有し、
 *    リグとスケルトンだけ人数ぶん作る（姿勢は人ごとに違うが形は同じ）。
 */
export function buildRawRig(scene: Scene, source: RawSource): {
  root: TransformNode; rig: RigHandle; skel: Skeleton; index: Map<string, number>;
} {
  const src: Record<string, [number, number, number]> = {};
  for (const b of source.skelJson.bones) {
    src[b.name] = toBabylon(b.head_rest[0], b.head_rest[1], b.head_rest[2]);
  }
  const rest = restPoseFrom(src, MIXAMO_NO_PREFIX, "left", source.height);
  const root = new TransformNode("rawRoot", scene);
  const rig = buildRig(scene, rest, { name: "raw", parent: root, allowMissing: true });
  const { skel, index } = buildSkeleton(scene, rig, "raw");
  return { root, rig, skel, index };
}

/** 読み込み済みの素材から1体を組む（同期）。 */
export function buildRawModelFrom(
  scene: Scene, source: RawSource, opts?: { jaw?: JawShape; noCavityCull?: boolean },
): RawModel {
  // 検証用の逃げ道。面の間引きを止めて、間引き版と当たり判定を突き合わせる
  // （間引きで穴が開いていないかを確かめる。probe-cull がこれを使う）。
  const noCavityCull = opts?.noCavityCull === true;
  const { skelJson, height, hairParts, hairNames } = source;
  const loadPart = source.loadPart;
  type Loaded = LoadedPart;

  // --- 1. モデル自身の rest → 標準ボーン名の RestPose → リグ → Skeleton ---
  const { root, rig, skel, index } = buildRawRig(scene, source);

  const mat = new StandardMaterial("rawMat", scene);
  // ⚠️ specularColor は Color3。Vector3 を入れると r/g/b が undefined になって描画が壊れる。
  mat.diffuseColor = new Color3(1, 1, 1);      // 色は頂点カラー（焼き込んだ元の色）が持つ
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = true;

  const meshes: Mesh[] = [];
  const byPart = new Map<string, Mesh>();
  const perBone = new Map<string, number>();
  let voxelCount = 0, triangles = 0, skinDropped = 0;

  // 読み込み済みの部位（髪型はここには入らない。選ばれたものだけ後で読む）
  const loaded: Loaded[] = source.parts.slice();

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
  const cover = clothPts.length ? clothCover(clothPts, clothLayer) : null;

  let bodyMesh: Mesh | null = null;
  let jaw: JawShape = opts?.jaw ?? "normal";
  /** body ぶんの内訳。あごを変えて張り直すとき二重に数えないため。 */
  let bodyStat = { vox: 0, tri: 0, drop: 0 };
  /** body のボクセル。顔に目・口を貼る位置を出すのに使う。 */
  let bodyCells: Cell[] = [];
  /** 体から求めたあごの情報。髭付きの髪型を同じ形に変えるのに使う。 */
  let jawFit: JawFit | null = null;
  /** ユニフォームの地の色。柄パーツから地を落とすのに使う。 */
  let baseCloth: number[] | null = null;
  let clothBaseDropped = 0;
  /** 地とみなす色の距離。赤(168,8,8)と黄(248,248,40)は 250 以上離れている。 */
  const CLOTH_BASE_TOL = 90;
  {
    const L = loaded.find((x) => x.part.prefix === "jersey");
    if (L) {
      const n = new Map<string, { col: number[]; n: number }>();
      for (const { voxels, palette } of L.chunks) {
        for (const v of voxels) {
          const col = palette[v[3] - 1];
          if (!col) continue;
          const k = col.join(",");
          const e = n.get(k);
          if (e) e.n++; else n.set(k, { col, n: 1 });
        }
      }
      let best = 0;
      for (const e of n.values()) if (e.n > best) { best = e.n; baseCloth = e.col; }
    }
  }

  // --- モデル本来の髪の色の散り方 -------------------------------------------
  // ⚠️ 差し替え用の髪型（Man Hair Collection）はテクスチャが無く**1色**で焼ける
  //    （実測: hairstyle_001 は 14,6,6 の 1 種のみ）。本来の髪は 182 階調あり、
  //    6,2,2 / 10,2,2 / 2,2,2 / 14,2,2 … と黒に近い色が散っている。
  //    その分布をそのまま写して、同じようにまばらにする。
  const hairDist: { col: number[]; acc: number }[] = [];
  let hairDistTotal = 0;
  {
    const L = loaded.find((x) => x.part.prefix === "hair");
    if (L) {
      const n = new Map<string, { col: number[]; n: number }>();
      for (const { voxels, palette } of L.chunks) {
        for (const v of voxels) {
          const c = palette[v[3] - 1];
          if (!c) continue;
          const k = c.join(",");
          const e = n.get(k);
          if (e) e.n++; else n.set(k, { col: c, n: 1 });
        }
      }
      for (const e of n.values()) { hairDistTotal += e.n; hairDist.push({ col: e.col, acc: hairDistTotal }); }
    }
  }
  /** 格子の位置から決まる色。同じ位置なら毎回同じ色になる（ちらつかない）。 */
  const hairColorAt = (x: number, y: number, z: number): number[] | null => {
    if (!hairDistTotal) return null;
    let h = (Math.imul(x + 512, 73856093) ^ Math.imul(y + 512, 19349663) ^ Math.imul(z + 512, 83492791)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    const t = (h >>> 0) % hairDistTotal;
    let lo = 0, hi = hairDist.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (hairDist[mid].acc <= t) lo = mid + 1; else hi = mid;
    }
    return hairDist[lo].col;
  };

  // --- 身長 ---------------------------------------------------------------
  // ⚠️ 頭頂は **body の最上端**で測る。全部位で測ると髪型（139種のうち高いもの）が
  //    混ざって身長が 26cm も伸びる（実測: grid.json の bb は 206.3cm、実体は 180.4cm）。
  let modelHeight = 1.8;
  let modelBottom = 0, modelCrown = 1.8;
  {
    let lo = Infinity, hi = -Infinity;
    for (const L of loaded) {
      const S2 = L.grid.voxel_size;
      const isBody2 = L.part.prefix === "body";
      for (const { ch, voxels } of L.chunks) {
        for (const v of voxels) {
          // ⚠️ ボクセルの**中心**ではなく描かれる立方体の上下端で測る。中心で測ると
          //    両端の半ボクセルぶん（合計 1 ボクセル）短く見積もり、そのぶん拡大率が
          //    大きくなって実際の身長が超過する。ボクセルを粗くするほど効く。
          //    実測: 18.75mm のとき 193cm 設定が 195.7cm（+1.4%）になっていた。
          const zLo = ch.grid_origin[2] + v[2] * S2;
          const zHi = zLo + S2;
          if (zLo < lo) lo = zLo;
          if (isBody2 && zHi > hi) hi = zHi;
        }
      }
    }
    if (isFinite(lo) && isFinite(hi) && hi > lo) {
      modelHeight = hi - lo;
      modelBottom = lo;
      modelCrown = hi;
    }
  }
  /**
   * 頭の大きさが身長に対してどれだけ変わるか。
   * ⚠️ 1.0（＝全身を一様に拡大）にすると、背の高い選手ほど頭が大きい子供体型になる。
   *    実際の成人は 身長 170→203cm(+19%) でも頭は 22→25cm(+13%) 程度しか変わらない。
   *    指数 0.5 は log(1.13)/log(1.19)=0.66 と log での実測の間を取った控えめな値。
   */
  const HEAD_EXP = 0.5;
  // ⚠️ 頭だけ別倍率にすると、単純に k = 目標/モデル では高さが合わない（実測で最大 1.1cm ずれた）。
  //    実際の高さ = k*(頭のボーンまで) + k^HEAD_EXP*(頭のボーンから頭頂まで) なので、
  //    これが目標に一致する k を数回の反復で解く。
  const headRestY = rig.restPosition("Head")?.y ?? modelCrown * 0.9;
  const bodyPart = headRestY - modelBottom;        // 足元から頭のボーンまで
  const headPart = Math.max(0, modelCrown - headRestY);  // 頭のボーンから頭頂まで
  const solveScale = (targetM: number): number => {
    let k = targetM / modelHeight;
    for (let i = 0; i < 8; i++) {
      const next = (targetM - Math.pow(k, HEAD_EXP) * headPart) / Math.max(1e-6, bodyPart);
      if (Math.abs(next - k) < 1e-6) { k = next; break; }
      k = next;
    }
    return k;
  };
  /** 全部位を作り直す（厚みが変わったとき）。 */
  const rebuildAll = (): void => {
    for (const L of loaded) {
      const mesh = byPart.get(L.part.prefix);
      buildPart(L, mesh ?? undefined);
    }
    buildMarks();
  };
  const setBody = (heightCm: number, weightKg: number): void => {
    bodyHeightCm = heightCm;
    bodyWeightKg = weightKg;
    const h = heightCm / 100;
    const next = Math.sqrt(weightKg / (BMI_REF * h * h));
    if (Math.abs(next - thickness) > 1e-4) {
      thickness = next;
      rebuildAll();
      model.thickness = thickness;
    }
    setHeight(heightCm);
  };
  const setHeight = (cm: number): void => {
    applyTo(root, rig, cm);
  };
  /** 身長合わせと肩幅合わせを、指定のリグへ掛ける（自分自身にも使う）。 */
  const applyTo = (r: TransformNode, g: RigHandle, cm: number): void => {
    // 肩幅（いまの厚みに合わせる。ジオメトリがその厚みで作られているため）
    const sw = 1 + (thickness - 1) * SHOULDER_W;
    for (const [name, x0] of shoulderBase) {
      const n = g.node(name as never);
      if (n) n.position.x = x0 * sw;
    }
    const k = solveScale(cm / 100);
    // 足元は y=0 付近にあるので、原点まわりの拡大で足が地面に残る
    r.scaling.setAll(k);
    const h = g.node("Head");
    // 頭だけ伸縮を戻して、最終的な頭の倍率を k^HEAD_EXP にする
    if (h) h.scaling.setAll(Math.pow(k, HEAD_EXP - 1));
  };

  // --- 体重による厚み -------------------------------------------------------
  // ⚠️ 骨の**軸から見た横方向**だけ伸ばす。体の中心から一律に伸ばすと、腕が
  //    体から離れる方向へ動いてしまう（T-pose なら 0.9m の位置が 15% 外へ = 13cm）。
  // ⚠️ 横方向(Blender の x,y)だけ伸ばすので、伸ばす量は骨の向きによって軸ごとに変わる。
  //    ボクセルの箱も同じ量だけ広げれば、隙間なくぴったり並ぶ。
  type BoneFrame = { a: [number, number, number]; ax: [number, number, number]; f: number };
  const boneFrame = new Map<string, BoneFrame>();
  {
    /** rig（Babylon）の rest 位置を Blender 座標へ戻す。toBabylon の逆。 */
    const toBlender = (v: { x: number; y: number; z: number }): [number, number, number] =>
      [-v.x, -v.z, v.y];
    for (const name of index.keys()) {
      const a = rig.restPosition(name as never);
      if (!a) continue;
      const childName = BONE_CHILD[name];
      const other = childName ? rig.restPosition(childName as never) : null;
      const parentName = BONE_PARENT[name];
      const par = parentName ? rig.restPosition(parentName as never) : null;
      const A = toBlender(a);
      let dir: [number, number, number] = [0, 0, 1];
      if (other) {
        const B = toBlender(other);
        dir = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      } else if (par) {
        const P = toBlender(par);
        dir = [A[0] - P[0], A[1] - P[1], A[2] - P[2]];
      }
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      boneFrame.set(name, {
        a: A, ax: [dir[0] / len, dir[1] / len, dir[2] / len],
        f: THICK_BY_BONE[name] ?? 1,
      });
    }
  }
  /** 骨番号 → 標準ボーン名。ボクセルごとに index を線形探索しないため。 */
  const boneName: string[] = [];
  for (const [n, i2] of index) boneName[i2] = n;
  /**
   * 肩幅の効き方。厚み倍率 1 からのズレに、この割合だけ肩の骨を内外へ動かす。
   * ⚠️ 厚みの変形はボクセルを**自分の骨の軸**に寄せるだけなので、骨の位置＝肩幅は変わらない。
   *    細い体型でも肩幅が広いままになるので、肩の骨自体を動かす。スキニングで腕全体が
   *    追従し、肩まわりはウェイトが混ざるので境目も出ない。
   */
  const SHOULDER_W = 0.7;
  // ⚠️ 肩の骨だけ動かしても幅はほとんど変わらない。実測では Chest→Shoulder が 0.067m、
  //    Shoulder→UpperArm（鎖骨にあたる）が 0.135m で、後者が主。両方を動かすこと。
  const shoulderBase = new Map<string, number>();
  for (const b of ["LeftShoulder", "RightShoulder", "LeftUpperArm", "RightUpperArm"]) {
    const n = rig.node(b as never);
    if (n) shoulderBase.set(b, n.position.x);
  }
  let thickness = 1;
  let bodyHeightCm = modelHeight * 100;
  let bodyWeightKg = BMI_REF * modelHeight * modelHeight;

  /**
   * 厚みを効かせた後のボクセル中心と、箱の広がり方（x,y,z の倍率）。
   * ⚠️ 横方向(x,y)だけ伸縮すると、軸がほぼ水平な**腕の太さが変わらない**。
   *    腕の軸は A-pose で (0.89, 0.06, -0.46) なので、太さの向きに垂直成分が多く含まれる。
   *    骨の軸に**垂直な成分を3軸とも**伸縮すること。軸に沿う成分は伸ばさないので、
   *    骨の長さ（＝手足の長さ）は変わらない。
   */
  const thicken = (bone: string | undefined, x: number, y: number, z: number):
  [number, number, number, number, number, number] => {
    const fr = bone ? boneFrame.get(bone) : undefined;
    if (!fr || fr.f === 0 || thickness === 1) return [x, y, z, 1, 1, 1];
    const m = 1 + (thickness - 1) * fr.f;
    const vx = x - fr.a[0], vy = y - fr.a[1], vz = z - fr.a[2];
    const along = vx * fr.ax[0] + vy * fr.ax[1] + vz * fr.ax[2];
    const nx = fr.a[0] + m * vx + (1 - m) * fr.ax[0] * along;
    const ny = fr.a[1] + m * vy + (1 - m) * fr.ax[1] * along;
    const nz = fr.a[2] + m * vz + (1 - m) * fr.ax[2] * along;
    // 隣のボクセルとの間隔も同じ割合で変わるので、箱もその分広げる（隙間が出ない）
    return [nx, ny, nz,
      m + (1 - m) * fr.ax[0] * fr.ax[0],
      m + (1 - m) * fr.ax[1] * fr.ax[1],
      m + (1 - m) * fr.ax[2] * fr.ax[2]];
  };

  /**
   * ボクセル1個ぶんの厚みを、スキンウェイトで**混ぜて**求める。
   * ⚠️ 一番強い骨だけで変形すると、袖(腕の骨)と胴(胸の骨)が別々に縮んで脇の下に
   *    隙間ができる（細い体型で顕著）。境目のボクセルは両方の骨で混ぜること。
   */
  const thickenBlend = (bi: number[], bw: number[], x: number, y: number, z: number):
  [number, number, number, number, number, number] => {
    if (thickness === 1) return [x, y, z, 1, 1, 1];
    let tx = 0, ty = 0, tz = 0, mx = 0, my = 0, mz = 0, sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = bw[k];
      if (!(w > 0)) continue;
      const [ax, ay, az, sx, sy, sz] = thicken(boneName[bi[k]], x, y, z);
      tx += ax * w; ty += ay * w; tz += az * w;
      mx += sx * w; my += sy * w; mz += sz * w; sum += w;
    }
    if (sum <= 0) return [x, y, z, 1, 1, 1];
    return [tx / sum, ty / sum, tz / sum, mx / sum, my / sum, mz / sum];
  };

  // ⚠️ 「他の部位に埋まっている面」も落とそうとしたが、やめた。部位ごとに格子の
  //    原点がずれているので、半分だけ服に潜っているマスを埋没と誤判定する。中心1点でも
  //    マスの8隅すべてでも漏れが残り、浅い角度から覗くと穴が見えた（レイ 5163 本中
  //    26本→1本。headless_sim/probe-cull.ts で再現できる）。三角形は 6% 増えるが、
  //    穴が開くよりましなので、根拠が明確な「密閉された空洞向き」だけ落とす。
  let cavityFaces = 0;

  // --- 背中の番号がどこにあるか ---------------------------------------------
  // ⚠️ 背中には「番号」と「Name」が乗っている。ゲーム側は番号だけを選手ごとに
  //    差し替えるので、その帯を知る必要がある。**面ではなく元のボクセルで**塊に
  //    分けて一番大きいものを番号とする（面は隠れたぶんを間引くので段が飛び、
  //    高さの切れ目では番号と Name を区別できない）。
  const backNumberBand = ((): { xLo: number; xHi: number; yLo: number; yHi: number } | null => {
    const L = loaded.find((x) => x.part.prefix === "jerseymark");
    if (!L) return null;
    const S = L.grid.voxel_size, O = L.grid.grid_origin;
    const cells: [number, number, number][] = [];
    for (const { ch, voxels, palette } of L.chunks) {
      const off = [0, 1, 2].map((i) => Math.round((ch.grid_origin[i] - O[i]) / S));
      for (const v of voxels) {
        // ⚠️ 地の色（ジャージの赤）のボクセルを外す。これを混ぜると番号と Name が
        //    地でつながって1つの塊になり、帯が Name まで伸びる（実測 21cm → 30cm）。
        const col = palette[v[3] - 1];
        if (baseCloth && col && Math.hypot(col[0] - baseCloth[0], col[1] - baseCloth[1],
          col[2] - baseCloth[2]) <= CLOTH_BASE_TOL) continue;
        const c: [number, number, number] = [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
        const b = toBabylon(O[0] + (c[0] + 0.5) * S, O[1] + (c[1] + 0.5) * S, O[2] + (c[2] + 0.5) * S);
        if (b[2] > -0.05) continue;                 // 背中側（-Z）だけ
        cells.push(c);
      }
    }
    if (!cells.length) return null;
    const at = new Map(cells.map((c, i) => [CELL_KEY(c[0], c[1], c[2]), i]));
    const par = cells.map((_, i) => i);
    const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
    for (const c of cells) {
      const i = at.get(CELL_KEY(c[0], c[1], c[2]))!;
      for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const j = at.get(CELL_KEY(c[0] + d[0], c[1] + d[1], c[2] + d[2]));
        if (j === undefined) continue;
        const a = find(i), b = find(j);
        if (a !== b) par[a] = b;
      }
    }
    const groups = new Map<number, [number, number, number][]>();
    for (const c of cells) {
      const r = find(at.get(CELL_KEY(c[0], c[1], c[2]))!);
      let g = groups.get(r); if (!g) { g = []; groups.set(r, g); }
      g.push(c);
    }
    let best: [number, number, number][] = [];
    for (const g of groups.values()) if (g.length > best.length) best = g;
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
    for (const c of best) {
      const b = toBabylon(O[0] + (c[0] + 0.5) * S, O[1] + (c[1] + 0.5) * S, O[2] + (c[2] + 0.5) * S);
      xLo = Math.min(xLo, b[0]); xHi = Math.max(xHi, b[0]);
      yLo = Math.min(yLo, b[1]); yHi = Math.max(yHi, b[1]);
    }
    return { xLo, xHi, yLo, yHi };
  })();

  /**
   * 部位の「外の空気」を求める。
   * ⚠️ ボクセル化は中身を詰めない（--no-interior）ので、体も服も**殻**になっている。
   *    殻の内側の面は絶対に見えないのに毎フレーム描いていた。境界箱の外周から
   *    空きセルを塗り広げ、届かなかった空き＝密閉された空洞とみなして面を張らない。
   *    「外から6方向に辿り着けない」ことが根拠なので、見える面を消す心配は無い。
   */
  const outsideAir = (cells: Cell[]): { has(cx: number, cy: number, cz: number): boolean } => {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of cells) for (let i = 0; i < 3; i++) {
      if (c.c[i] < lo[i]) lo[i] = c.c[i];
      if (c.c[i] > hi[i]) hi[i] = c.c[i];
    }
    lo = lo.map((v) => v - 1); hi = hi.map((v) => v + 1);
    const nx = hi[0] - lo[0] + 1, ny = hi[1] - lo[1] + 1, nz = hi[2] - lo[2] + 1;
    const n = nx * ny * nz;
    const at = (x: number, y: number, z: number): number => (z * ny + y) * nx + x;
    const solid = new Uint8Array(n);
    for (const c of cells) solid[at(c.c[0] - lo[0], c.c[1] - lo[1], c.c[2] - lo[2])] = 1;
    const air = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    const push = (i: number): void => { if (!solid[i] && !air[i]) { air[i] = 1; q[tail++] = i; } };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) push(at(x, y, z));
    }
    while (head < tail) {
      const i = q[head++];
      const x = i % nx, y = ((i / nx) | 0) % ny, z = (i / (nx * ny)) | 0;
      if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1);
      if (y > 0) push(i - nx); if (y < ny - 1) push(i + nx);
      if (z > 0) push(i - nx * ny); if (z < nz - 1) push(i + nx * ny);
    }
    return {
      has: (cx, cy, cz) => {
        const x = cx - lo[0], y = cy - lo[1], z = cz - lo[2];
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return true;  // 箱の外＝外気
        return air[at(x, y, z)] === 1;
      },
    };
  };

  /** 部位1つぶんのメッシュを作る。reuse を渡すと同じメッシュへ張り直す（あご変更時）。 */
  /**
   * ボクセルを lod×lod×lod の塊にまとめて粗くする（遠景用）。
   * 色は塊の平均、ウェイトは塊の代表セルのものを使う。
   * ⚠️ ウェイトを平均してはいけない。骨の番号が違うもの同士を混ぜると腕が胴へ
   *    引っ張られる。同じ塊のセルはほぼ同じ骨なので代表で足りる。
   */
  const downsample = (cells: Cell[], lod: number): Cell[] => {
    const acc = new Map<number, { c: [number, number, number]; r: number; g: number; b: number; n: number; wi: number }>();
    for (const c of cells) {
      const k: [number, number, number] = [
        Math.floor(c.c[0] / lod), Math.floor(c.c[1] / lod), Math.floor(c.c[2] / lod)];
      const key = CELL_KEY(k[0], k[1], k[2]);
      let e = acc.get(key);
      if (!e) { e = { c: k, r: 0, g: 0, b: 0, n: 0, wi: c.wi }; acc.set(key, e); }
      e.r += c.col[0]; e.g += c.col[1]; e.b += c.col[2]; e.n++;
    }
    return [...acc.values()].map((e) => ({
      c: e.c, col: [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number], wi: e.wi,
    }));
  };

  const buildPart = (L: Loaded, reuse?: Mesh, lod = 1): Mesh | null => {
    const { part, grid, w, chunks: loadedChunks } = L;
    const S = grid.voxel_size;
    // 服の中に隠れる肌は描かない（body だけが対象。服・髪・目はそのまま）
    const isBody = part.prefix === "body";
    const cullSkin = cover && isBody;
    // ⚠️ 首は服の判定で丸ごと消えていた。clothCover は「同じ高さの服の最大半径」で
    //    内外を決めるので、首の高さの層には肩・胸（半径0.3）が入り、半径0.05の首は
    //    問答無用で「服の中」になる。実測: 首の肌が全層で落ちていた（各層 115〜163 個）。
    //    首は襟の穴から見えるし、あごを短くしたときに顔の下を埋めるのもここ。除外する。
    // ⚠️ 首は clothCover の判定で丸ごと消えていた。判定は「同じ高さの層にある服の
    //    **最大**半径」で内外を決めるので、首の高さの層には肩・胸（半径0.39）が入り、
    //    半径0.07 の首は問答無用で「服の中」になる。実測で首の肌が全層で落ちていた。
    //    正しくは「服の**最内殻**より内側なら襟の穴の中＝上から見えるので残す」。
    //    手で決めた円柱や箱で抜くと、うなじが落ちたり首が肩幅になったりして合わない。
    const NECK_DEPTH = 0.30;       // 頭頂からこの深さまで。それ以下は服の中で見えない
    let bodyTopZ = -Infinity;
    if (isBody) {
      for (const { ch, voxels } of loadedChunks) {
        for (const v of voxels) bodyTopZ = Math.max(bodyTopZ, ch.grid_origin[2] + (v[2] + 0.5) * S);
      }
    }

    // 部位の格子で「そこにボクセルがあるか」を引けるようにする（隠れた面を描かないため）
    let cells: Cell[] = [];
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
          // 首の柱は残す（上の注意を参照）
          // ⚠️ margin を +S にすると、首の肌と襟の内側の間に1ボクセルの環状の抜けが残り、
          //    そこから中が透けて「首に隙間」に見える。少し外まで残して塞ぐ。
          const isNeck = wz > bodyTopZ - NECK_DEPTH && cover!.inHole(wx, wy, wz, S);
          // 服より内側なら描かない。margin は服の厚みぶんの余裕（負で少し内側まで残す）
          if (!isNeck && cover!.under(wx, wy, wz, -S)) { skinDropped++; continue; }
        }
        cells.push({ c, col: palette[v[3] - 1] ?? [200, 200, 200], wi: myWi });
      }
    }
    if (!cells.length) return null;
    // ⚠️ ユニフォームの柄（jerseymark）は文字の周りのポリゴンごと抜いているので、
    //    地の赤が混ざる（実測 5279 個中 2476 個）。そのまま出すと赤い板が浮いて見える。
    //    土台と同じ色のボクセルは落とし、柄の色だけ残す。
    if (part.prefix === "jerseymark" && baseCloth) {
      const before = cells.length;
      cells = cells.filter((c) => {
        const d = Math.hypot(c.col[0] - baseCloth![0], c.col[1] - baseCloth![1], c.col[2] - baseCloth![2]);
        return d > CLOTH_BASE_TOL;
      });
      clothBaseDropped += before - cells.length;
    }
    // 差し替え用の髪型はモデル本来の髪と同じ色の散り方にする（上の注意を参照）
    if (part.prefix.startsWith("hairstyle_") && hairDistTotal > 0) {
      for (const c of cells) {
        const col = hairColorAt(c.c[0], c.c[1], c.c[2]);
        if (col) c.col = col;
      }
    }
    // 顔のバリエーション: あごだけ作り替える
    if (isBody) jawFit = jawFitFrom(cells, grid.grid_origin, S);
    if (isBody && jaw !== "normal" && jawFit) {
      cells = reshapeJaw(cells, grid.grid_origin, S, jaw, jawFit, true);
    }
    // 髭のある髪型は、あごの形に合わせて同じ変形を掛ける
    if (part.prefix.startsWith("hairstyle_") && jaw !== "normal" && jawFit) {
      cells = reshapeJaw(cells, grid.grid_origin, S, jaw, jawFit, false);
    }
    // 首まわりの縫い目を埋める。服の判定で肌を間引くと1〜2個の抜けが残り、
    // そこから中が透けて「首に隙間」に見える。標準の顔でも起きるのでここで塞ぐ。
    if (isBody && bodyTopZ > -Infinity) {
      cells = closeSeams(cells, 2, grid.grid_origin, S, (x, y, z) =>
        z > bodyTopZ - 0.30 && Math.abs(x) < 0.12 && Math.abs(y) < 0.12);
    }
    // 遠景用に粗くする（ボクセルを lod 個ぶんの塊にまとめる）
    if (lod > 1) cells = downsample(cells, lod);
    const SS = S * lod;                       // まとめたあとのボクセル寸法
    const occupied = new Set<number>();
    for (const c of cells) occupied.add(CELL_KEY(c.c[0], c.c[1], c.c[2]));
    const air = outsideAir(cells);

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
      const domName = boneName[bi4[0]];
      if (domName) perBone.set(domName, (perBone.get(domName) ?? 0) + 1);

      // --- 露出面だけ張る ---
      const [cx, cy, cz] = cell.c;
      const wx = O[0] + (cx + 0.5) * SS, wy = O[1] + (cy + 0.5) * SS, wz = O[2] + (cz + 0.5) * SS;
      const [tx, ty, tz, mx, my, mz] = thickenBlend(bi4, bw4, wx, wy, wz);
      for (const f of FACES) {
        if (occupied.has(CELL_KEY(cx + f.d[0], cy + f.d[1], cz + f.d[2]))) continue;
        // 殻の内側（外気と繋がっていない空洞）に向いた面は描かない
        if (!noCavityCull && !air.has(cx + f.d[0], cy + f.d[1], cz + f.d[2])) { cavityFaces++; continue; }
        const base = pos.length / 3;
        for (const q of f.q) {
          const [px, py, pz] = toBabylon(tx + q[0] * SS * mx, ty + q[1] * SS * my, tz + q[2] * SS * mz);
          pos.push(px, py, pz);
          const [nx, ny, nz] = toBabylon(f.n[0], f.n[1], f.n[2]);
          nrm.push(nx, ny, nz);
          col.push(cell.col[0] / 255, cell.col[1] / 255, cell.col[2] / 255, 1);
          mIdx.push(bi4[0], bi4[1], bi4[2], bi4[3]);
          mWgt.push(bw4[0], bw4[1], bw4[2], bw4[3]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        if (lod === 1) triangles += 2;
      }
      if (lod === 1) voxelCount++;
    }

    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.colors = col;
    vd.indices = idx;
    vd.matricesIndices = mIdx;
    vd.matricesWeights = mWgt;
    const mesh = reuse ?? new Mesh(`raw_${lod > 1 ? "lod_" : ""}${part.prefix}`, scene);
    vd.applyToMesh(mesh, false);
    mesh.material = mat;
    mesh.parent = root;
    mesh.skeleton = skel;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;
    // ⚠️ **遠景用(lod>1)のメッシュで上書きしてはいけない。** 上書きすると setJaw が
    //    遠景用のほうを作り直し、実際に表示されるメッシュは一度も変わらない
    //    （実測: setJaw 後 bodyMesh は 11,136 頂点になるのに、byPart.get("body") は
    //     12,576 頂点のまま。あごの形を変えても見た目が変わらない原因）。
    if (isBody && lod === 1) { bodyMesh = mesh; bodyCells = cells; }
    return mesh;
  };

  for (const L of loaded) {
    const v0 = voxelCount, t0 = triangles, d0 = skinDropped;
    const mesh = buildPart(L);
    if (L.part.prefix === "body") {
      bodyStat = { vox: voxelCount - v0, tri: triangles - t0, drop: skinDropped - d0 };
    }
    if (!mesh) continue;
    meshes.push(mesh);
    byPart.set(L.part.prefix, mesh);
  }



  /** 顔に描いた目・口を、半分の大きさの立方体のメッシュにする。 */
  let markMesh: Mesh | null = null;
  const buildMarks = (): void => {
    const L = loaded.find((x) => x.part.prefix === "body");
    if (!L || !bodyCells.length) return;
    const S = L.grid.voxel_size, H = S * MARK_HALF, O = L.grid.grid_origin;
    const list = faceMarks(bodyCells, O, S);
    const head = index.get("Head") ?? index.get("Hips") ?? 0;
    const pos: number[] = [], nrm: number[] = [], col: number[] = [];
    const mIdx: number[] = [], mWgt: number[] = [], idx: number[] = [];
    for (const mk of list) {
      for (const f of FACES) {
        const b = pos.length / 3;
        for (const q of f.q) {
          const [px, py, pz] = toBabylon(mk.x + q[0] * H, mk.y + q[1] * H, mk.z + q[2] * H);
          pos.push(px, py, pz);
          const [nx, ny, nz] = toBabylon(f.n[0], f.n[1], f.n[2]);
          nrm.push(nx, ny, nz);
          col.push(mk.col[0] / 255, mk.col[1] / 255, mk.col[2] / 255, 1);
          mIdx.push(head, 0, 0, 0);
          mWgt.push(1, 0, 0, 0);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    const vd = new VertexData();
    vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.indices = idx;
    vd.matricesIndices = mIdx; vd.matricesWeights = mWgt;
    const mesh = markMesh ?? new Mesh("raw_face", scene);
    vd.applyToMesh(mesh, true);
    mesh.material = mat;
    mesh.parent = root;
    mesh.skeleton = skel;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;
    if (!markMesh) { markMesh = mesh; meshes.push(mesh); byPart.set("face", mesh); }
  };
  buildMarks();

  /**
   * 髪型を1つ読み込んでメッシュにする（既に読んであれば何もしない）。
   * ⚠️ 髭のある髪型（実測 67/139 件）はあごの形に追従させるので、あごを変えたあとに
   *    読んだものも同じ変形が掛かる（buildPart の中で jawFit を見る）。
   */
  const hairLoaded = new Map<string, Loaded>();
  const loadHair = async (name: string): Promise<boolean> => {
    if (!name || hairLoaded.has(name)) return hairLoaded.has(name);
    const part = hairParts.find((x) => x.prefix === name);
    if (!part) return false;
    const L = await loadPart(part);
    hairLoaded.set(name, L);
    loaded.push(L);                 // あごを変えたとき張り直せるように
    const mesh = buildPart(L);
    if (mesh) { meshes.push(mesh); byPart.set(name, mesh); }
    return true;
  };

  // --- 遠景用の粗いメッシュ -------------------------------------------------
  // ⚠️ ボクセルを2個ぶんの塊にまとめるので、面はおおよそ 1/4 になる。
  //    数メートル離れれば見分けはつかない。
  const LOD_STEP = 2;
  const lodMeshes = new Map<string, Mesh>();
  const lodPart = (name: string): Mesh | null => {
    const hit = lodMeshes.get(name);
    if (hit) return hit;
    const L = loaded.find((x) => x.part.prefix === name);
    if (!L) return null;
    const m = buildPart(L, undefined, LOD_STEP);
    if (!m) return null;
    m.setEnabled(false);
    lodMeshes.set(name, m);
    return m;
  };

  /** あごの形を変える。body のメッシュだけを張り直す。 */
  const setJaw = (shape: JawShape): void => {
    if (shape === jaw) return;
    jaw = shape;
    const L = loaded.find((x) => x.part.prefix === "body");
    if (!L || !bodyMesh) return;
    // 統計と頭皮の位置は作り直す（二重に数えないため）
    voxelCount -= bodyStat.vox; triangles -= bodyStat.tri; skinDropped -= bodyStat.drop;
    const v0 = voxelCount, t0 = triangles, d0 = skinDropped;
    buildPart(L, bodyMesh);
    bodyStat = { vox: voxelCount - v0, tri: triangles - t0, drop: skinDropped - d0 };
    model.voxelCount = voxelCount; model.triangles = triangles; model.skinDropped = skinDropped;
    buildMarks();                     // 顔の表面が動いたので目・口も貼り直す
    // 髭のある髪型はあごの形に追従するので、読んであるものは張り直す
    for (const [name, HL] of hairLoaded) buildPart(HL, byPart.get(name));
  };

  const model: RawModel = {
    rig, root, skel, meshes, byPart, voxelCount, triangles, height, perBone, skinDropped, cavityFaces, lodPart, lodStep: LOD_STEP, backNumberBand,
    setJaw, hairNames, loadHair,
    modelHeightCm: modelHeight * 100, setHeight, setBody, thickness, applyTo,
  };
  return model;
}

/** 読み込みと組み立てをまとめて行う（確認ページ用）。 */
export async function buildRawModel(
  scene: Scene, baseUrl: string, opts?: { jaw?: JawShape; noCavityCull?: boolean },
): Promise<RawModel> {
  return buildRawModelFrom(scene, await preloadRawSource(baseUrl), opts);
}
