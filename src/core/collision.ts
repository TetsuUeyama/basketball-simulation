// 選手同士の衝突解決。重なった選手を押し離す物理と、押し合いの重み
// (holdWeight: ボール保持者やパサーは踏ん張る)。毎フレーム updateLive から呼ぶ。
import { Vector3 } from "@babylonjs/core";
import { Player } from "../objects/player/player";
import { BENCH, BODY_MIN_DIST, POST_SEAL_R } from "../config";
import { rate, rand } from "../util";
import type { Game } from "../game";

// ベンチ(長椅子)の水平の占有範囲。座面の前縁から背もたれの後縁まで。
const BENCH_X0 = BENCH.x - BENCH.seatD / 2;

/**
 * オフボール同士のぶつかり合い。ボディバランス差 → 押し出す距離と、動けない時間。
 * ⚠️ 接触時の実際の差は 中央 0.07 / 最大 0.25 しかない。gain で拡げてから使う。
 */
const BODY_PUSH = {
  gain: 3.2,        // 差を拡げる倍率
  dist: 0.045,      // 1フレームあたり押し出す距離(m)の上限係数
  max: 0.018,       // 1フレームの押し出し上限(m)。⚠️ ここを上げると1フレームの移動が
  //                  走れる量を超えて**ワープに見える**（実測: 0.05 で 3倍超の跳びが 2→8件）。
  //                  押し合いは「接触が続く間ずっと押される」で表現する。
  stun: 0.30,       // 動けない時間(s)の係数
  stagger: 0.45,    // これを超えて負けると体勢が崩れる（よろめき→立て直し）
  stunMax: 0.35,    // 動けない時間の上限(s)
  //                  ⚠️ 0.15/0.18 に弱めても得点は変わらない（乱数種で大小が逆転した:
  //                  種1 16.2 vs 15.0 / 種2 15.4 vs 16.3）。スタンは攻守どちらにも
  //                  同じだけ起きる（実測 攻撃49% / 守備51%）ので、得点の増減を
  //                  スタンのせいにしないこと。
};
const BENCH_X1 = BENCH.x + BENCH.seatD / 2 + BENCH.backT;

/** 立っている体をベンチの外へ押し出す（座っている選手は対象外）。ベンチは実在の
 *  障害物なので、歩いて戻る交代選手やライン外へ飛び出した選手が突き抜けない。
 *  近い側（コート側 / 背面側）へ逃がす。r は体の半径。 */
export function blockBench(pos: Vector3, r = BODY_MIN_DIST / 2): void {
  const zLo = BENCH.zMid - BENCH.len / 2, zHi = BENCH.zMid + BENCH.len / 2;
  const az = Math.abs(pos.z);
  if (az < zLo - r || az > zHi + r) return;              // 列の外(両ハーフとも対称)
  if (pos.x < BENCH_X0 - r || pos.x > BENCH_X1 + r) return;
  // コート側へ出るか背面へ出るか、近い方
  const toFront = pos.x - (BENCH_X0 - r), toBack = (BENCH_X1 + r) - pos.x;
  pos.x = toFront < toBack ? BENCH_X0 - r : BENCH_X1 + r;
}

  // 重なった体を等分に押し離す（重みなしの単純版）。d≈0 はランダム方向へずらす。
export function pushApart(bodies: Player[], min = BODY_MIN_DIST): void {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 1e-4) { dx = rand(-1, 1); dz = rand(-1, 1); d = Math.hypot(dx, dz) || 1; }
        const push = (min - d) / 2;
        a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
      }
    }
  }

  // 衝突した2選手を押し離す。補正を「踏ん張り」の重みで分配する。
  // 毎フレーム、全ての移動の後に実行する。
export function resolveCollisions(game: Game, ): void {
    const MIN = BODY_MIN_DIST; // カプセル半径の約2倍
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < game.players.length; i++) {
        for (let j = i + 1; j < game.players.length; j++) {
          const a = game.players[i], b = game.players[j];
          let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
          let d = Math.hypot(dx, dz);
          if (d >= MIN) continue;
          if (d < 1e-4) { dx = rand(-1, 1); dz = rand(-1, 1); d = Math.hypot(dx, dz) || 1; }
          const overlap = MIN - d;
          const nx = dx / d, nz = dz / d;
          const wa = holdWeight(game, a), wb = holdWeight(game, b);
          // 踏ん張りの重みを2乗して強さ差を強調する（強い者はほとんど押されない）
          const wa2 = wa * wa, wb2 = wb * wb;
          const total = wa2 + wb2;
          a.pos.x -= nx * overlap * (wb2 / total); a.pos.z -= nz * overlap * (wb2 / total);
          b.pos.x += nx * overlap * (wa2 / total); b.pos.z += nz * overlap * (wa2 / total);

          // 地上のオフボール同士のぶつかり合い: ボディバランスの差が大きいほど
          // 弱い方が押し出され、次の動きに入るまでの時間も長くなる。
          // ⚠️ 実分布の差は小さい（接触時の |差| は中央 0.07・最大 0.25）。そのまま使うと
          //    何も起きないので、ここでゲインを掛ける。
          // ⚠️ 押すのは**接触している間だけ**。位置を直接置き換えるのではなく、
          //    「ぶつかった結果ずれる」量として足す（毎フレームの分離解決の一部）。
          // ⚠️ デッドボール中（交代・一時停止・スローイン待ち）は押し合わない。
          //    実測で交代中に 160 件の押し出しが起きていた（歩いているだけの場面）。
          const live = game.ballMode === "held" || game.ballMode === "pass"
            || game.ballMode === "loose" || game.ballMode === "shot"
            || game.ballMode === "charge";
          if (live && !a.airborne && !b.airborne && game.handler !== a && game.handler !== b
              && a.team !== b.team) {
            const diff = rate(a.attr.balance) - rate(b.attr.balance);
            const edge = Math.abs(diff) * BODY_PUSH.gain;          // 0..~1
            if (edge > 0.06) {
              const loser = diff > 0 ? b : a;
              const winner = diff > 0 ? a : b;
              const sgn = diff > 0 ? 1 : -1;                        // 勝者→敗者の向き
              // ⚠️ 押し勝った側が常に「勝者→敗者」の向きへ弾き飛ばすのは、**守備側では逆効果**。
              //    ボディバランスの強い守備者が弱い攻撃者を吹き飛ばすと、攻撃者はゴール下の
              //    離れた場所に**フリーで解放される**（守備が自分から引き剥がしている）。
              //    実際のポストディフェンスは弾かずに、体を当てて**ゴールから遠ざける**。
              //    そこで、ゴール下(POST_SEAL_R 以内)で守備側が押し勝った時だけ、押す向きを
              //    「リムから見て外向き」に差し替える。攻撃側が押し勝った時は今まで通り
              //    弾き飛ばす（ゴール下でフリーに貰うことを優先する）。
              let px = nx * sgn, pz = nz * sgn;
              if (winner.team === 1 - game.possession) {
                const rimF = game.attackFloor(loser.team);          // 敗者(攻撃側)が攻めるリム
                const ox = loser.pos.x - rimF.x, oz = loser.pos.z - rimF.z;
                const od = Math.hypot(ox, oz);
                if (od > 1e-4 && od < POST_SEAL_R) { px = ox / od; pz = oz / od; }
              }
              const push = Math.min(BODY_PUSH.max, edge * BODY_PUSH.dist);
              loser.pos.x += px * push;
              loser.pos.z += pz * push;
              // 体勢を崩した側は次の動きに入れない
              loser.shovedT = Math.max(loser.shovedT,
                Math.min(BODY_PUSH.stunMax, edge * BODY_PUSH.stun));
              // ⚠️ 大きく負けたときは**体勢が崩れる**。よろめき（foulReaction）を使うと、
              //    崩れた姿勢のまま数歩たたらを踏み、立て直してから動き出す。
              //    数字の上でだけ止めても画面では何も起きない（実測: スタン中央 0.06秒）。
              if (edge > BODY_PUSH.stagger && loser.foulReactT <= 0 && !loser.airborne) {
                loser.foulReaction("hurt", px, pz,
                  Math.min(0.9, 0.3 + edge * 0.6));
              }
            }
          }
          // 空中での衝突: 強い体が相手を弾き飛ばす
          if (a.airborne && b.airborne) {
            const diff = rate(a.attr.balance) - rate(b.attr.balance);
            const knock = Math.abs(diff) * 0.6;
            if (diff > 0) { b.pos.x += nx * knock; b.pos.z += nz * knock; }
            else { a.pos.x -= nx * knock; a.pos.z -= nz * knock; }
          }
        }
      }
    }
    for (const p of game.players) blockBench(p.pos);   // ベンチは実在の障害物
    // 全員をコート内に保つ。ただし subs/pause/finale 中はクランプしない
    // （スローイン・交代・引き上げで選手が正当にコート外へ出る）。
    if (game.ballMode === "subs" || game.ballMode === "pause"
        || game.ballMode === "finale") return;
    // スローインする者／パサーはコート外に立つのでクランプ対象から除く。
    const skip = game.ballMode === "inbound" ? game.handler
      : game.ballMode === "pass" ? game.passer : null;
    for (const p of game.players) if (p !== skip) game.clampCourt(p.pos);
  }

  // 衝突時に選手がどれだけ踏ん張るか（高いほど押しが強い）。ボディバランスが効く。
export function holdWeight(game: Game, p: Player): number {
    let w = 0.5 + rate(p.attr.balance) * 0.78;                // ~0.6（弱い）.. ~1.28（強い）
    if (p === game.handler) {
      w += 0.5 + (p.has("post") ? 0.3 : 0);                   // ボールを守る／ポストアップする
      if (p.keepShieldT > 0) w += 1.3;                        // 踏ん張るキーパー: 広いスタンスで動かせない
    }
    else if (p.screening) w += 0.6;                           // セットしたスクリーンはしっかり踏ん張る
    else if (p.team === 1 - game.possession) w += 0.25;       // 守備者は位置を保つ
    return w;
  }
