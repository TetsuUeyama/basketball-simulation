// シュートの「効果」= 成功率の算出（判定ルール）。状態を変更しない純粋関数。
// 呼び出し側が最寄り守備者・ヘルプ人数・クラッチ値・ブザー有無などの文脈を渡し、確率のみ返す。
import { Player } from "../../objects/player/player";
import { THREE_DIST } from "../../config";
import { rate, clamp, chance } from "../../util";
import { perimContest, palmRadius, rimProtect } from "../../eval";

// ジャンプシュート（ミドル/3P）の成功確率。距離・射程・コンテストから算出し、
// 0.02〜0.93 にクランプして返す（レイアップ/ダンクは finishAtRim 側で別途）。
/**
 * 3Pの「素の」成功率（コンテスト・溜め不足・精神などを引く前）。
 * ⚠️ 線形（旧: 0.14 + 精度×0.42）だと1点あたりの差が全域で同じで、しかも幅が
 *    41.2%→53.8% の 12.6ポイントしか無かった。設計要件は
 *    **「L精度が下がるほど1点の重みが増す」**なので、最高値からの**不足分の二乗**で落とす。
 *      L精度100 → 55.0%（TOP）
 *      不足 (1 - 精度/100) の二乗に FALL を掛けて引く
 *    結果（1点下がった時の差 / 1万本あたり）:
 *      95→23本  90→43本  85→64本  80→84本  75→105本  70→125本  65→146本
 *    上に行くほど差が詰まり、下に行くほど開く。単調増加は全域で保証される。
 */
/** 3Pのコンテストが届く距離の上乗せ(m)。守備1.8mがフリーと同値にならないようにする。 */
const THREE_CONTEST_REACH = 0.6;
/** 同じくミドルの上乗せ。守備1.5mがフリーと同値になるのを防ぐ。 */
const MID_CONTEST_REACH = 0.6;
// ⚠️ お膳立て（良いパサーから貰った時の +最大0.28）を廃止したぶん、全体が落ちた
//    （実測: 3P 29.0% → 21.6% / FG 46.3% → 45.0%）。パサー依存を外すのが目的で
//    成功率を下げるのが目的ではないので、**素の基準値を一律 +0.05 して戻す**。
/**
 * ミドルの「素の」成功率。
 * ⚠️ 旧: `0.35 + S精度/100 * 0.42` の**線形**。S精度60と90の差が 12.6ポイントしかなく、
 *    「ミドルが下手な選手」が事実上存在しなかった（実測: S精度70が5m・守備1.2mで 52.1%、
 *    最高の95でも 59.6% で差は 7.5ポイント）。3Pと同じく**不足分の二乗**で落とす形にし、
 *    下を沈めて能力差を出す。
 * 設計の基準点（この2点から TOP/FALL/MID_DIST を逆算した）:
 *    S精度95・2m → 75% / S精度65・6m → 25%
 * 距離の減衰は 1mあたり 4.5ポイント（旧 3.0）。
 */
const MID_TOP = 0.7792;
const MID_FALL = 2.6667;
const MID_DIST = 0.045;
function midSkillTerm(acc: number): number {
  const miss = 1 - clamp(acc, 0, 100) / 100;
  return MID_TOP - MID_FALL * miss * miss;
}

const THREE_TOP = 0.60;
const THREE_FALL = 2.05;
function threeSkillTerm(acc: number): number {
  const miss = 1 - clamp(acc, 0, 100) / 100;
  return THREE_TOP - THREE_FALL * miss * miss;
}



export function jumpShotMakeProbability(
  h: Player, dHoop: number, dDef: number,
  ctx: {
    isThree: boolean;            // 3P か（⚠️ コーナーは直線判定なので距離からは決められない）
    nearestDef: Player | null;   // 最寄り守備者（クローズアウトの質とリーチに使用）
    helpCount: number;           // 2.4m以内の守備人数（isoShooter 判定用）
    clutch: number;              // clutchFactor(h)：精神×プレッシャー
    prepShort: number;           // 準備不足の秒数（急ぎ撃ち/ブザー — 大きいほど精度低下）
    prepExtra: number;           // 準備延長の秒数（どフリーでじっくり — 精度微増、上限あり）
    palmHitbox: boolean;         // 手のひら当たり判定モデルの有効/無効
  },
): number {
  const isThree = ctx.isThree;
  // make % = この距離での選手の技量から、距離とコンテストを差し引く
  const skill = rate(isThree ? h.attr.threeAcc : h.attr.midAcc);
  // ⚠️ 3P の基準値。実測で 3P が 43% 入っていた（実際のバスケットは約36%）。
  // ミドルは midSkillTerm を使う（旧: baseLine + skill * 0.42 の線形）
  const distRef = isThree ? THREE_DIST : 1.5;
  // L速度は深い3Pの減衰を緩め、特能ミドルは全距離で緩める
  let falloff = isThree ? 0.05 - rate(h.attr.threeRange) * 0.035 : MID_DIST;
  if (h.has("range")) falloff *= 0.65;
  const over = Math.max(0, dHoop - distRef);
  // 遠投は二次で崩れる。L速度が崩れを少し緩める。
  const heaveDrop = isThree ? over * over * 0.011 * (1 - rate(h.attr.threeRange) * 0.33) : 0;
  let p = (isThree ? threeSkillTerm(h.attr.threeAcc) : midSkillTerm(h.attr.midAcc))
    - over * falloff - heaveDrop;
  // ダイレクトプレイ: キャッチ&シュートのリズム
  if (h.quickT > 0 && h.has("oneTouch")) p += 0.05;
  // ⚠️ お膳立て（良いパサーから貰った）の **成功率への上乗せは廃止**。
  //    最大 +0.28 あり、ミドルの精度依存の幅(0.42)に対して大きすぎた
  //    （＝シュートが上手いかより、誰から貰ったかで決まっていた）。
  //    いまは setupQuick として「捕球の硬直が短い / リリースが速い」に効かせている
  //    （passing.ts の gather と eval.ts の shotWindupFor）。速く打てれば守備が
  //    詰める前に放てるので結果は良くなるが、**確率を直接足してはいない**。
  // コンテスト — S威力は接触を突いて打つ。1対1シュート特化は単独守備をほぼ感じない。
  // 係数0.45: S威力の実分布は68..97(中央74)なので、0.78ではスケールが0.24..0.47まで
  // 縮んでコンテストがほぼ効かなくなっていた。
  let contestScale = 1 - rate(h.attr.shotStrength) * 0.45;
  if (h.has("isoShooter") && ctx.helpCount <= 1) contestScale *= 0.6;
  // クローズアウトの質は位置＋体格で決まる（速い外守備は飛んでくる、遅いビッグは遅れる）。
  const cn = ctx.nearestDef;
  const perimQ = cn ? clamp(1 + perimContest(cn, h), 0.6, 1.5) : 1;
  // コンテストのリーチ = 手のひら当たり判定（有効時 def−off でサイズ可変、無効時は固定1.8m）。
  // ⚠️ 3P限定で、伸ばした手の届く距離を広げる。打点が高く溜めも長いぶん、
  //    寄せている守備は遠くからでも視界とリリースを乱せる。
  //    ⚠️ `palmRadius` 自体を上げてミドルやリム下まで一律に伸ばすと、全体の FG が
  //    　 46.7% → 42.3% まで落ちた（実際は約47%）。**3Pだけに効かせること。**
  // ⚠️ ミドルにもリーチの上乗せを足す。素の `palmRadius` は中庸の組み合わせで約1.5mなので、
  //    **守備が1.5m離れると5m放置と完全に同値**になっていた（実測: S精度80・5mで
  //    守備1.5m も 2.0m も 51.5% で減点0）。1.5mのクローズアウトは実際には圧力になる。
  //    3Pには THREE_CONTEST_REACH で対処済みだったが、ミドルは手つかずだった。
  const cReach = (ctx.palmHitbox && cn ? palmRadius(cn, h) : 1.8)
    + (isThree ? THREE_CONTEST_REACH : MID_CONTEST_REACH);
  p -= clamp(cReach - dDef, 0, cReach) * 0.24 * contestScale * perimQ;
  // 目の前で跳んで手をシュートコースに入れてくる守備者は、視界とリリースを乱して精度を大きく削る。
  // (今までは水平距離だけでコンテストを測っていた — 跳んだ手のコンテストを make% に反映)
  if (cn && cn.airborne && dDef < cReach + 0.4) {
    const inFace = clamp(1 - dDef / (cReach + 0.4), 0, 1);   // 0(離れ)..1(目の前)
    p -= inFace * 0.35 * contestScale;
  }
  // 体勢の崩れ（移動しながらの射撃）— S技術がメカニクスを保つ
  if (h.beatenT > 0 || h.curSpd > h.runSpeed * 0.55) {
    p -= 0.10 * (1 - rate(h.attr.shotTech));
  }
  // 精神: 疲労・劣勢・終盤の重圧が弱い心を乱す
  p -= ctx.clutch * 0.12;
  // 準備不足(急ぎ撃ち/ブザー): 溜め切れなかった秒数だけ精度が落ちる。S技術が落ち込みを緩和。
  if (ctx.prepShort > 0) p -= ctx.prepShort * 0.5 * (1 - rate(h.attr.shotTech) * 0.4);
  // 準備延長(どフリーでじっくり): 溜めを延ばした秒数だけ精度が少し上がる(上限0.4秒相当)。
  if (ctx.prepExtra > 0) p += Math.min(ctx.prepExtra, 0.4) * 0.12;
  return clamp(p, 0.02, 0.93);   // 低い下限で遠投も数%は残す
}

// リング下のフィニッシュ（レイアップ/ダンク）の効果。ダンクにするか(dunk)を抽選し、
// 成功率(p, 0.05〜0.97)とともに返す。
/** 重心を崩された状態でのフィニッシュの落ち幅（offBalT 1秒あたり）。 */
const OFF_BALANCE_FINISH = 0.45;

export function rimFinishOutcome(
  h: Player, dDef: number,
  ctx: {
    nearestDef: Player | null;   // 最寄り守備者（リムプロテクトの質）
    crowd: number;               // 2.4m以内の守備人数（人だかりの壁）
    clutch: number;              // clutchFactor(h)
  },
): { dunk: boolean; p: number } {
  // ジャンプ+ヘッドで叩き込めるか、バランスで体を割ってダンクできるか
  const athletic = rate(h.attr.jump) * 0.5 + rate(h.attr.dunk) * 0.3 + rate(h.attr.balance) * 0.2;
  const lane = dDef > 1.1 || (rate(h.attr.balance) > 0.65 && dDef > 0.6);
  // ダンクを選ぶこと自体は運動能力で決まる（跳べるなら跳ぶ）。
  const dunk = lane && chance(0.06 + athletic * 0.7);
  // 役割分担:
  //   ・**素の決定力 = シュート精度**（ダンクでもレイアップでも）。フリーなら決まるもの。
  //     ⚠️ 以前のダンクは 0.82 + ダンク能力×0.15 で**シュート精度を一切見なかった**。
  //        跳べない精度型がダンクを選ぶと精度が結果に出ない（実測: 運動能力 55〜70 の
  //        選手でも 50% がダンクを選んでいた）。
  //     ⚠️ フリーのレイアップは 0.5 + 精度×0.35 では上手い選手でも 85% 止まりで、
  //        「フリーなのに外す」絵になっていた。
  //   ・**ダンク能力 = 競られても決め切る強さ**。下の接触の罰をここで減らす（ダンカーの優位性）。
  //   ダンクは構えが要らないぶん素の決定力が少し高く、精度の効きは小さい。
  // ⚠️ ドリブルから持ち込んだフィニッシュは、お膳立てのボーナスを一度も受けていない
  //    （rimFinishOutcome はこの値を読んでいない）。それでも全体を +0.05 揃えるので
  //    ここも同じだけ上げる。
  let p = (dunk ? 0.83 : 0.67) + rate(h.attr.midAcc) * (dunk ? 0.20 : 0.33);
  // 逆サイドのレイアップは逆手フィニッシュ — 逆手精度(2..8)で綺麗に、片手選手は落とす（ダンクは両手で対象外）
  if (!dunk && h.driveSide === -h.strongSide()) {
    p -= (1 - h.offhandAcc / 8) * 0.1;
  }
  const strong = rate(h.attr.shotStrength);
  // コンテストの質は位置＋体格で決まる（リム保護ビッグは壁、スイッチしたガードは邪魔にならない）。
  const near = ctx.nearestDef;
  const contestQ = near ? clamp(1 + rimProtect(near, h), 0.5, 1.6) : 1;
  // ⚠️ ここがダンカーの優位性。接触されても・手が伸びてきても決め切る強さは
  //    **ダンク能力 + S威力**。ダンクを選んだかではなく、その能力そのもので効かせる
  //    （精度型はフリーなら決めるが、競られると落ちる。ダンカーは競られても落ちない）。
  const through = rate(h.attr.dunk) * 0.6 + strong * 0.4;
  p -= clamp(1.1 - dDef, 0, 1.0) * 0.42 * (1 - through * 0.78) * contestQ;
  // マークを突いてフィニッシュ — 守備が付いている時だけ効き、密着度でスケール（75が中立）。
  const mark = clamp((1.5 - dDef) / 1.5, 0, 1);   // 0 オープン .. 1 密着
  p += (rate(h.attr.offense) - 0.75) * 1.6 * mark;
  // リム付近の人だかりは壁 — 2-3人へ突っ込むのは低確率。
  if (ctx.crowd >= 2) p -= (ctx.crowd - 1) * 0.23 * (1 - strong * 0.2);
  p -= ctx.clutch * 0.1;
  // 体を当てられて重心が崩れている: 強い守備者に押し負けた分だけ決まらなくなる。
  if (h.offBalT > 0) p -= clamp(h.offBalT, 0, 0.7) * OFF_BALANCE_FINISH;
  return { dunk, p: clamp(p, 0.05, 0.97) };
}
