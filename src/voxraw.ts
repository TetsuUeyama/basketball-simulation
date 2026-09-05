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
  round: { width: (t) => 1 - 0.31 * Math.pow(t, 1.4), depth: (t) => 1 - 0.28 * t * t * t, shorten: 0.022 },
  // 細あご: 横を強く落として V ライン。短縮は控えめ
  narrow: { width: (t) => 1 - 0.50 * Math.pow(t, 1.1), depth: (t) => 1 - 0.34 * t * t * t, shorten: 0.015 },
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
function reshapeJaw(
  cells: Cell[], O: number[], S: number, shape: Exclude<JawShape, "normal">,
): Cell[] {
  const P = JAW_PROFILE[shape];
  const wx = (i: number): number => O[0] + (i + 0.5) * S;
  const wy = (j: number): number => O[1] + (j + 0.5) * S;
  const wz = (k: number): number => O[2] + (k + 0.5) * S;

  let topZ = -Infinity;
  for (const c of cells) topZ = Math.max(topZ, wz(c.c[2]));
  // 実測（頭頂Z1.802 / 服に隠れた肌を除いたメッシュ）: 頭頂から
  //   0.131〜0.236m … 幅 0.184→0.140 でほぼ一定＝あご（ここを削る）
  //   0.245m 以降  … 幅 0.096 の首（触らない）
  // ⚠️ jawBottom を 0.240 にしていたら、その下に残るあご先（前方へ 0.096 まで
  //    突き出す刃状の部分。実測で 0.255 付近まで続く）が変形対象外で残り、
  //    丸顔・細あごにしても「あごの下に突起」として見えていた。刃の下まで帯を伸ばす。
  const jawTop = topZ - 0.130, jawBottom = topZ - 0.265;
  /** これより下は首。横を削らずに守る（削ると首がくびれる）。 */
  const neckTop = topZ - 0.235;

  // 帯の中の頭の中心（腕・肩を除くため中心軸の近くだけ見る）
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
  // ⚠️ ここで |x| を絞らずに i/j の窓を取ると、窓が腕・肩まで広がる。
  //    窓の中の元セルは下で消すので、T-pose の腕（|x| 最大 0.9）が丸ごと消えた。
  //    窓は頭・首の柱だけにすること。
  for (const c of cells) {
    const z = wz(c.c[2]);
    if (z < jawBottom || z > jawTop) continue;
    const x = wx(c.c[0]), y = wy(c.c[1]);
    if (Math.abs(x) > 0.16) continue;
    iMin = Math.min(iMin, c.c[0]); iMax = Math.max(iMax, c.c[0]);
    jMin = Math.min(jMin, c.c[1]); jMax = Math.max(jMax, c.c[1]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!isFinite(minX) || !isFinite(iMin)) return cells;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let maxYAll = -Infinity;
  for (const c of cells) {
    const z = wz(c.c[2]);
    if (z >= jawBottom && z <= jawTop && Math.abs(wx(c.c[0])) < 0.16) maxYAll = Math.max(maxYAll, wy(c.c[1]));
  }

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
  const backY = maxYAll;
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
    const zSrcA = (zTgt - S / 2) - shorten * liftAt(zTgt - S / 2);
    const zSrcB = (zTgt + S / 2) - shorten * liftAt(zTgt + S / 2);
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
      const syA = y - S / 2 < cy ? cy + (y - S / 2 - cy) / dep : y - S / 2;
      const syB = y + S / 2 < cy ? cy + (y + S / 2 - cy) / dep : y + S / 2;
      const sjLo = Math.round((Math.min(syA, syB) - O[1]) / S - 0.5);
      const sjHi = Math.round((Math.max(syA, syB) - O[1]) / S - 0.5);
      const f = frontness(y);
      for (let i = iLo; i <= iHi; i++) {
        const x = wx(i);
        const wid = 1 + (P.width(t) - 1) * f * guard;
        const sxA = cx + (x - S / 2 - cx) / wid, sxB = cx + (x + S / 2 - cx) / wid;
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
  /** あごの形を変える（顔のバリエーション）。body のメッシュだけ張り直す。 */
  setJaw(shape: JawShape): void;
  height: number;
  perBone: Map<string, number>;
}

/**
 * 生の出力を読み込み、モデル自身のスケルトンへ**スキニングして**返す。
 * `applyMotion(model.rig, clip, t)` → `model.skel.prepare()` で変形する。
 */
export async function buildRawModel(
  scene: Scene, baseUrl: string, opts?: { jaw?: JawShape },
): Promise<RawModel> {
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
  const cover = clothPts.length ? clothCover(clothPts, clothLayer) : null;

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
    hairCover.set(L.part.prefix, clothCover(pts, Math.max(0.02, L.grid.voxel_size * 2)).under);
    hairColor.set(L.part.prefix, color ?? [60, 45, 35]);
    hairVoxel.set(L.part.prefix, L.grid.voxel_size);
  }
  /** body のボクセルごとの色バッファ上の範囲（頭皮を塗り替えるため）。 */
  const bodyVox: { x: number; y: number; z: number; s: number; e: number }[] = [];
  let bodyMesh: Mesh | null = null;
  let bodyCol: number[] = [];
  let jaw: JawShape = opts?.jaw ?? "normal";
  /** body ぶんの内訳。あごを変えて張り直すとき二重に数えないため。 */
  let bodyStat = { vox: 0, tri: 0, drop: 0 };

  /** 部位1つぶんのメッシュを作る。reuse を渡すと同じメッシュへ張り直す（あご変更時）。 */
  const buildPart = (L: Loaded, reuse?: Mesh): Mesh | null => {
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
    // 顔のバリエーション: あごだけ作り替える
    if (isBody && jaw !== "normal") cells = reshapeJaw(cells, grid.grid_origin, S, jaw);
    // 首まわりの縫い目を埋める。服の判定で肌を間引くと1〜2個の抜けが残り、
    // そこから中が透けて「首に隙間」に見える。標準の顔でも起きるのでここで塞ぐ。
    if (isBody && bodyTopZ > -Infinity) {
      cells = closeSeams(cells, 2, grid.grid_origin, S, (x, y, z) =>
        z > bodyTopZ - 0.30 && Math.abs(x) < 0.12 && Math.abs(y) < 0.12);
    }
    const occupied = new Set<number>();
    for (const c of cells) occupied.add(CELL_KEY(c.c[0], c.c[1], c.c[2]));

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
        if (occupied.has(CELL_KEY(cx + f.d[0], cy + f.d[1], cz + f.d[2]))) continue;
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
    const mesh = reuse ?? new Mesh(`raw_${part.prefix}`, scene);
    // ⚠️ body だけ updatable。頭皮の色を髪型に合わせて後から書き換えるため。
    vd.applyToMesh(mesh, isBody);
    mesh.material = mat;
    mesh.parent = root;
    mesh.skeleton = skel;
    mesh.numBoneInfluencers = 4;
    mesh.alwaysSelectAsActiveMesh = true;
    if (isBody) { bodyMesh = mesh; bodyCol = col; }
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

  // --- 髪の下の頭皮を髪色で塗る ---
  // ⚠️ 顔（目・鼻・口）は塗らない。前髪のある髪型だと方位判定が顔まで覆ってしまい、
  //    顔が髪色に染まる。頭頂から 9cm より下の前面は対象外にする。
  const headTop = bodyVox.reduce((m, v) => Math.max(m, v.z), 0);
  const faceZ = headTop - 0.09;
  let tintedWith = "";
  const applyScalpTint = (name: string): number => {
    tintedWith = name;
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

  /** あごの形を変える。body のメッシュだけを張り直す。 */
  const setJaw = (shape: JawShape): void => {
    if (shape === jaw) return;
    jaw = shape;
    const L = loaded.find((x) => x.part.prefix === "body");
    if (!L || !bodyMesh) return;
    // 統計と頭皮の位置は作り直す（二重に数えないため）
    voxelCount -= bodyStat.vox; triangles -= bodyStat.tri; skinDropped -= bodyStat.drop;
    const v0 = voxelCount, t0 = triangles, d0 = skinDropped;
    bodyVox.length = 0;
    buildPart(L, bodyMesh);
    bodyStat = { vox: voxelCount - v0, tri: triangles - t0, drop: skinDropped - d0 };
    model.voxelCount = voxelCount; model.triangles = triangles; model.skinDropped = skinDropped;
    applyScalpTint(tintedWith);       // 頂点が変わったので塗り直す
  };

  const model: RawModel = {
    rig, root, skel, meshes, byPart, voxelCount, triangles, height, perBone, skinDropped,
    applyScalpTint, setJaw,
  };
  return model;
}
