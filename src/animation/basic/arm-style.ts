// 走る腕振りの個人差。選手ごとに固定（名前から決めるので、同じ選手なら毎試合同じ癖）。
//
// 入れている差は3つ:
//   1. 振り幅・肘の抱え方（肩から先の角度そのもの）
//   2. 肘の引き — 腕が後ろへ行ったとき、肘をどれだけ下げる(伸ばす)か
//   3. 体への寄り — 脇の開きを詰めて、上腕から先が体の近くを通るようにする
//
// ⚠️ 左右で別の値を引く。同じ値だと左右対称に振れて、かえって作り物に見える。
// ⚠️ コートの向き(numberSide)には一切依存しない。選手に付く癖なので、どちらの
//    ゴールへ攻めても同じ側の腕が同じ癖で振れる。
import type { Player } from "../../objects/player/player";

export interface ArmStyle {
  /** 振り幅の倍率（1 = 既定）。 */
  swing: number;
  /** 走行中の肘の抱え込みの倍率（1 = 既定）。 */
  carry: number;
  /** 腕が後ろへ行き切ったときに肘を伸ばす量(rad)。左右で別。 */
  pullL: number; pullR: number;
  /** 脇の開きから引く量(rad)。大きいほど上腕以降が体の近くを通る。左右で別。 */
  inL: number; inR: number;
}

/** 名前 → 32bit ハッシュ（FNV-1a）。同じ名前なら常に同じ癖になる。 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** xorshift32。乱数の種を名前から作るので、試合をまたいでも同じ値が出る。 */
function rng(seed: number): () => number {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// 幅の設計値。ここを広げるほど選手ごとの差が大きくなる。
const SWING = [0.82, 1.18];    // 振り幅の倍率
const CARRY = [0.80, 1.20];    // 肘の抱え込みの倍率
const PULL  = [0.05, 0.45];    // 肘の引き(rad) ≈ 3°〜26°
const IN    = [0.00, 0.26];    // 体への寄り(rad) ≈ 0°〜15°
// 左右差。基準値からこの幅だけずらす（左右で完全に独立させると別人の腕に見える）。
const LR = 0.35;

const CACHE = new Map<string, ArmStyle>();
/** 確認ページ用の上書き（ゲームでは常に null）。指定した項目だけ全員に効く。 */
let OVERRIDE: Partial<ArmStyle> | null = null;
export function setArmStyleOverride(o: Partial<ArmStyle> | null): void { OVERRIDE = o; }

/** この選手の腕の癖。名前で引くので、交代でスロットの中身が入れ替わっても付いて回る。 */
export function armStyleFor(p: Player): ArmStyle {
  const key = p.name;
  const hit = CACHE.get(key);
  if (hit) return OVERRIDE ? { ...hit, ...OVERRIDE } : hit;
  const r = rng(hash(key));
  const lerp = (a: number[], t: number): number => a[0] + (a[1] - a[0]) * t;
  const pull = lerp(PULL, r());
  const inw = lerp(IN, r());
  const dp = (r() * 2 - 1) * LR, di = (r() * 2 - 1) * LR;
  const st: ArmStyle = {
    swing: lerp(SWING, r()),
    carry: lerp(CARRY, r()),
    pullL: Math.max(0, pull * (1 + dp)), pullR: Math.max(0, pull * (1 - dp)),
    inL: Math.max(0, inw * (1 + di)), inR: Math.max(0, inw * (1 - di)),
  };
  CACHE.set(key, st);
  return OVERRIDE ? { ...st, ...OVERRIDE } : st;
}
