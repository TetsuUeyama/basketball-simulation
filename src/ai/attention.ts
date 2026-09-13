// 注目システム: 「いま誰を見ているか」を1か所で決め、顔の向き（見た目）と
// 「見ていないものへの反応の鈍さ」（中身）の両方に効かせる。
//
// 決め方（役割ごと）:
//   ボール保持者      … 攻めるリム（＝プレーの行き先）
//   オフボールの攻撃  … ボール（受けるため）。ただし自分のマーカーに潰されている間は
//                       マーカーを見る（抜く隙を探す）
//   オンボールの守備  … 相手＝ボール（同じ物）
//   オフボールの守備  … **ボール or 自分のマーク**。レーンを塞いでいる間はボールを見て
//                       パスを狙い、マークが速く動いた／離れたらマークを見る
//
// ⚠️ 見ていない方向への反応は鈍る。`attnFactor` は「そっちをどれだけ見ているか」を
//    0.35〜1.0 で返す。正面が 1.0、真横で約 0.6、背中側が 0.35。
//    これを反応時間・カット率・キャッチの安定に掛ける。
import type { Game } from "../game";
import type { Player } from "../objects/player/player";
import { dist2D, normAngle, rate } from "../util";

/** 何を見ているか（HUD/デバッグ表示と、見え方の切り替えに使う）。 */
export type AttnKind = "rim" | "ball" | "man" | "handler";

/**
 * 注目による鈍りの効きめ。0 で「全部見えている」＝従来どおり、1 で完全適用。
 * ⚠️ 顔の向き（見た目）は常に動く。ここで切るのは**中身の鈍り**だけ。
 */
export const ATTN = { power: 1 };

/** 視野の端でも完全には見えなくならない（周辺視野）。背中側の下限。 */
const SIDE_FLOOR = 0.35;
/** ここまでは正面と同じに見えている（rad）。 */
const SHARP = 0.45;      // ≈26°
/** ここを越えると周辺視野（rad）。 */
const WIDE = 1.75;       // ≈100°

/**
 * その世界点をどれだけ見ているか（0.35〜1.0）。
 * ⚠️ 基準は**頭の向き**（root + 胴のツイスト + 首のヨー）。体の向きではない。
 *    体は走る方向を向き、頭だけ別を見ていられるのがこのシステムの肝。
 */
export function attnFactor(p: Player, x: number, z: number): number {
  const fx = x - p.pos.x, fz = z - p.pos.z;
  if (Math.abs(fx) + Math.abs(fz) < 1e-4) return 1;
  const head = p.root.rotation.y + p.torsoTwist + p.headYaw;
  const a = Math.abs(normAngle(Math.atan2(fx, fz) - head));
  let f: number;
  if (a <= SHARP) f = 1;
  else if (a >= WIDE) f = SIDE_FLOOR;
  else f = 1 - (1 - SIDE_FLOOR) * ((a - SHARP) / (WIDE - SHARP));
  return 1 - (1 - f) * ATTN.power;
}

/** 相手プレイヤーをどれだけ見ているか。 */
export function attnTo(p: Player, other: Player): number {
  return attnFactor(p, other.pos.x, other.pos.z);
}

/**
 * 全員の注目先を決めて `gazeX/gazeZ/gazeKind` に書く。毎フレーム1回、
 * AI を動かしたあと（位置が確定したあと）に呼ぶ。
 */
export function updateAttention(game: Game, dt: number): void {
  const b = game.ball.pos;
  for (const p of game.players) {
    const own = p.team === game.possession;
    let kind: AttnKind = "ball";
    let x = b.x, z = b.z;
    if (p === game.handler || p === game.shooter) {
      const rim = game.attackFloor(p.team);
      kind = "rim"; x = rim.x; z = rim.z;
    } else if (own) {
      // オフボールの攻撃: 基本はボール。潰されている間だけマーカーを見る。
      const d = game.teamPlayers(1 - p.team)[p.slot];
      if (d && p.frontedT > 0 && dist2D(d.pos, p.pos) < 2.6) {
        kind = "man"; x = d.pos.x; z = d.pos.z;
      }
    } else {
      const man = game.teamPlayers(game.possession)[p.slot];
      if (man && game.handler === man) { kind = "handler"; x = man.pos.x; z = man.pos.z; }
      else if (man) {
        // ボールを見るか、マークを見るか。レーンを塞いでいる間はボールを見て
        // パスを狙う（そのぶんマークの動き出しへの反応が鈍る＝バックドアに弱い）。
        const mSpd = Math.hypot(man.velX, man.velZ);
        const watchMan = !p.denyT || mSpd > 3.2 || dist2D(p.pos, man.pos) > 4.5;
        if (watchMan) { kind = "man"; x = man.pos.x; z = man.pos.z; }
      }
    }
    // 守備は「自分のマークが見えている位置」を持つ。実位置へ**遅れて**追従し、
    // その遅れが振り切りの余地になる。⚠️ ここで全守備者ぶん毎フレーム更新すること。
    //    守備の分岐（戻り/オンボール）に入っている間だけ止めると見え位置が古くなり、
    //    分岐に戻った瞬間に目標が飛ぶ（実測: 遅れの90%が 4.74m まで伸びていた）。
    if (!own && p !== game.handler) {
      const man = game.teamPlayers(game.possession)[p.slot];
      if (man) {
        if (!p.trackOn) { p.trackX = man.pos.x; p.trackZ = man.pos.z; p.trackOn = true; }
        // ⚠️ ボールの方を見ている守備は、マークの動き出しに気づくのが遅れる。
        //    視線が自分のマークに無いときは追従をさらに落とす（注目システムの本体）。
        const see = (0.12 + attnTo(p, man) * 0.88) * (p.gazeKind === "man" ? 1 : 0.72);
        const late = man.shakeOpenT > 0 ? 0.22 : 1;
        const k = 1 - Math.exp(-(5 + rate(p.attr.reaction) * 11) * see * late * dt);
        p.trackX += (man.pos.x - p.trackX) * k;
        p.trackZ += (man.pos.z - p.trackZ) * k;
        const lx = man.pos.x - p.trackX, lz = man.pos.z - p.trackZ;
        const lag = Math.hypot(lx, lz);
        if (lag > 2.2) { p.trackX += lx * (1 - 2.2 / lag); p.trackZ += lz * (1 - 2.2 / lag); }
      }
    }
    // 首を振る速さ。反応と敏捷の高い選手ほど早く目標を切り替えられる。
    const turn = 3.0 + (rate(p.attr.reaction) * 0.6 + rate(p.attr.agility) * 0.4) * 7;
    if (p.gazeKind !== kind) p.gazeSwitchT = 1;      // 切り替え直後は見えていない扱い
    p.gazeSwitchT = Math.max(0, p.gazeSwitchT - dt * turn * 0.5);
    p.gazeKind = kind;
    p.gazeX = x; p.gazeZ = z;
  }
}
