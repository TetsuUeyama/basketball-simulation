// ゴール下（レイアップ/ダンク）の成功率を、守備の近さと選手の精度別に測る。
// ⚠️ 「フリー」は守備が 1.5m 以上離れている場合とする（式の罰は 1.1m 以内でのみ効く）。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);

type Row = { free: boolean; made: boolean; dunk: boolean; acc: number; d: number; name: string;
  swat: boolean; graze: boolean; dunkAttr: number; jumpAttr: number };
const rows: Row[] = [];
const jump: { made: boolean; d: number; acc: number; dh: number }[] = [];
let lastShooter: Player | null = null;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const before = game.shooter;
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== before && sh !== lastShooter) {
      lastShooter = sh;
      const rim = game.attackFloor(sh.team);
      const dHoop = dist2D(sh.pos, rim);
      // ⚠️ レイアップは 2〜3m から踏み切るので、リリース時の距離だけで絞ると取りこぼす。
      //    フィニッシュ（ドライブから突っ込む）判定と距離の両方で拾う。
      // ⚠️ ゴール下でも「フィニッシュ」ではなくジャンプショット扱いの球がある。
      //    見た目はレイアップでも別の確率式（jumpShotMakeProbability）を通る。
      const isFinish = game.shooterFinishing;
      if (dHoop < 2.5 && !isFinish) {
        const nd2 = game.nearestDefender(sh);
        jump.push({ made: game.shotMade, d: nd2 ? dist2D(sh.pos, nd2.pos) : 9,
          acc: sh.attr.midAcc, dh: dHoop });
      }
      if (dHoop < 4.0 && (isFinish || dHoop < 2.2)) {
        const nd = game.nearestDefender(sh);
        const dDef = nd ? dist2D(sh.pos, nd.pos) : 9;
        rows.push({
          free: dDef > 1.5, made: game.shotMade, dunk: game.shotWasDunk,
          acc: sh.attr.midAcc, d: dDef, name: sh.name,
          dunkAttr: sh.attr.dunk, jumpAttr: sh.attr.jump,
          // ⚠️ 「外れた」の中身を分ける。ブロック/かすりは確率式ではなく別処理。
          swat: false, graze: game.shotGraze > 0,
        });
      }
    }
    if (!sh) lastShooter = null;
  }
}
const pc = (a: Row[]): string => a.length
  ? (a.filter((r) => r.made).length / a.length * 100).toFixed(1) + "%（" + a.length + "本）" : "-";
console.log(NG + "試合  ゴール下の試投 " + rows.length + "本");
console.log("  フリー(守備1.5m超): " + pc(rows.filter((r) => r.free)));
console.log("  　うちダンク: " + pc(rows.filter((r) => r.free && r.dunk))
  + " / レイアップ: " + pc(rows.filter((r) => r.free && !r.dunk)));
console.log("  competed(1.5m以内): " + pc(rows.filter((r) => !r.free)));
console.log("\nフリーのレイアップを 中距離精度 別に:");
for (const [lo, hi] of [[0, 50], [50, 65], [65, 80], [80, 90], [90, 101]]) {
  const a = rows.filter((r) => r.free && !r.dunk && r.acc >= lo && r.acc < hi);
  console.log("  精度 " + lo + "〜" + hi + ": " + pc(a));
}
const top = rows.filter((r) => r.free && r.acc >= 85);
console.log("\n精度85以上の選手のフリー(ダンク込み): " + pc(top));

// ダンクを選んだ割合（運動能力別）と、その成功率。
// ⚠️ ダンクの確率式は **シュート精度を見ない**（0.82 + ダンク能力×0.15）。
//    跳べない選手がダンクを選ぶと、精度の高さが結果に反映されない。
console.log("\nダンクを選んだ割合（ダンク能力とジャンプの平均で分ける）:");
for (const [lo, hi] of [[0, 55], [55, 70], [70, 85], [85, 101]]) {
  const a = rows.filter((r) => {
    const ath = (r.dunkAttr + r.jumpAttr) / 2;
    return ath >= lo && ath < hi;
  });
  const dk = a.filter((r) => r.dunk);
  console.log("  運動能力 " + lo + "〜" + hi + ": ダンク選択 "
    + (dk.length / Math.max(1, a.length) * 100).toFixed(0) + "%（" + dk.length + "/" + a.length + "本）"
    + " / ダンク成功 " + pc(dk) + " / レイアップ成功 " + pc(a.filter((r) => !r.dunk)));
}

// 守備との距離で細かく（レイアップ/ダンク合計）
console.log("\n守備との距離で細かく:");
for (const [lo, hi] of [[0, 0.8], [0.8, 1.1], [1.1, 1.5], [1.5, 2.5], [2.5, 99]]) {
  const a = rows.filter((r) => r.d >= lo && r.d < hi);
  console.log("  " + lo + "〜" + hi + "m: " + pc(a)
    + " / ダンク率 " + (a.filter((r) => r.dunk).length / Math.max(1, a.length) * 100).toFixed(0) + "%");
}

// ダンカーの優位性: **競られている場面(1.1m以内)** の成功率をダンク能力別に。
// ⚠️ フリーの成功率で差が出るのは精度、競り合いで差が出るのがダンク能力、という設計。
console.log("\n競られている場面(守備1.1m以内)の成功率:");
for (const [lo, hi] of [[0, 60], [60, 75], [75, 88], [88, 101]]) {
  const a = rows.filter((r) => r.d < 1.1 && r.dunkAttr >= lo && r.dunkAttr < hi);
  console.log("  ダンク能力 " + lo + "〜" + hi + ": " + pc(a));
}
console.log("フリー(1.5m超)の成功率を 中距離精度 別に:");
for (const [lo, hi] of [[0, 65], [65, 80], [80, 101]]) {
  const a = rows.filter((r) => r.d > 1.5 && r.acc >= lo && r.acc < hi);
  console.log("  精度 " + lo + "〜" + hi + ": " + pc(a));
}
