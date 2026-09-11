// ジャンプ: 開始・飛行/着地の更新・手の最高到達点。
import { rate, clamp } from "../../util";
import { Player } from "../../objects/player/player";

declare module "../../objects/player/player" {
  interface Player {
    jump(height: number, dur: number, leapX?: number, leapZ?: number): void;
    stretchAir(minRemain: number): void;
    updateJump(dt: number): void;
    reachTopY(): number;
  }
}

/** `height` メートルの、`dur` 秒続くジャンプを開始する。任意の (leapX,leapZ) は
 *  飛行全体に分散する水平の踏み込み — 正面にないシュートへの斜めのジャンプ
 *  （高さは低いが、ブロックするために横へ届く）。 */
/** 踏み切り前の沈み込み(秒)。人は膝を曲げてから跳ぶ — 無反動では跳べない。
 *  素早い(敏捷性)選手ほど短く、高く跳ぼうとするほど深く沈む。
 *  ⚠️ 長くしてはいけない。実測(60試合)で 0.10〜0.20秒にするとオフェンスリバウンドが
 *     27% → **32%** へ跳ね上がった(実在値は 22〜28%)。空中の競り合いはこの数フレームに
 *     敏感で、全員の踏み切りが遅れると落下点で競れず、こぼれ球が増えて攻撃側に回る。
 *     0.03〜0.10秒なら 27% に収まる。見た目のために伸ばすなら必ず probe-rebside で測ること。 */
export function jumpLoadFor(p: Player, height: number): number {
  const quick = rate(p.attr.agility);
  const deep = clamp(0.55 + height * 0.75, 0.55, 1.25);   // 高い跳躍ほど深く沈む
  return clamp((0.078 - quick * 0.028) * deep, 0.03, 0.10);
}

Player.prototype.jump = function(height: number, dur: number, leapX = 0, leapZ = 0): void {
    // 前回の着地からまだバランスを立て直している最中——まだ跳べない
    if (this.landT > 0) return;
    // 既に沈み込み中: 上書きしない(二重に踏み切らない)
    if (this.loadT > 0) return;
    // 体を当てられて重心が崩れている — 踏み切れない
    if (this.offBalT > 0) return;
    // ⚠️ 空中では踏み切り直さない。jumpRemaining を dur へ戻すと k=0 → jumpY=0 になり、
    //    体が一瞬床へ落ちてから跳び直して見える（空中リバウンド→プットバックで顕著）。
    //    滞空を伸ばしたい側は stretchAir を明示的に呼ぶ。
    if (this.jumpRemaining > 0) return;
    // ⚠️ ここでは踏み切らない。まず沈み込む(反動動作)。実際の離陸は updateJump が
    //    loadT を使い切った時に行う。airborne は沈み込み中 false のまま。
    this.loadT = this.loadDur = jumpLoadFor(this, height);
    this.loadH = height;
    this.loadJDur = dur;
    this.loadLX = leapX;
    this.loadLZ = leapZ;
};

/** 今の弧を切らずに滞空を `minRemain` 秒まで伸ばす。jumpY = sin(k*π)*H
 *  （k = 1 - remaining/dur）なので remaining と dur を同率で伸ばせば k が変わらず、
 *  今の高さを保ったまま降下だけが緩やかになる。 */
Player.prototype.stretchAir = function(minRemain: number): void {
    if (this.jumpRemaining <= 0 || minRemain <= this.jumpRemaining) return;
    const s = minRemain / this.jumpRemaining;
    this.jumpDur *= s;
    this.jumpRemaining = minRemain;
};

Player.prototype.updateJump = function(dt: number): void {
    if (this.loadT > 0) {
      // 沈み込み中: 膝を曲げて溜める。使い切ったら踏み切る。
      this.jumpLoadTarget = 1;
      this.loadT = Math.max(0, this.loadT - dt);
      if (this.loadT === 0) {
        this.jumpHeight = this.loadH;
        this.jumpDur = this.loadJDur;
        this.jumpRemaining = this.loadJDur;
        this.leapX = this.loadLX;
        this.leapZ = this.loadLZ;
        this.jumpLoadTarget = 0;   // 一気に伸び上がる
      }
      return;
    }
    this.jumpLoadTarget = 0;
    if (this.jumpRemaining > 0) {
      // 斜めのジャンプは飛行中を一定レートで水平に運ぶ
      // （弾道: 水平速度一定）ので、総移動量 = (leapX,leapZ)
      if (this.jumpDur > 0 && (this.leapX !== 0 || this.leapZ !== 0)) {
        const f = Math.min(dt, this.jumpRemaining) / this.jumpDur;
        this.pos.x += this.leapX * f;
        this.pos.z += this.leapZ * f;
      }
      this.jumpRemaining = Math.max(0, this.jumpRemaining - dt);
      if (this.jumpRemaining === 0) {
        // 着地 硬直: 再ジャンプや爆発の前に重心が落ち着く必要がある。クイックネス(敏捷性)と
        // ジャンプ力で駆動（両方エリートで~0.3s、両方低いとフルジャンプで≈2.5s）。大きい
        // ジャンプはリセットがやや遅い。再ジャンプを阻み、最初の数歩を鈍らせる(accelSpeed)。
        const ability = (rate(this.attr.agility) + rate(this.attr.jump)) / 2;   // 1 = 両方エリート
        const base = 0.3 + Math.pow(1 - ability, 0.85) * 2.2;                    // 0.3 .. 2.5 (フルジャンプ)
        const heightScale = clamp(0.5 + this.jumpHeight * 0.9, 0.45, 1.3);
        this.landDur = this.landT = clamp(base * heightScale, 0.3, 2.6);
        this.rootT = Math.max(this.rootT, this.landT * 0.4);   // 着地の頭側は完全硬直（動けない）
        this.leapX = this.leapZ = 0;
      }
    }
};

/** 手が現在届く最高点（立ちリーチ+ジャンプ）。 */
Player.prototype.reachTopY = function(): number {
  return this.jumpY() + this.height * 1.35;
};
