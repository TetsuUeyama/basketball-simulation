// ワープ（1フレームで走れる以上に飛ぶ移動）が無いかを全フレーム・全選手で見張る。
// ⚠️ 位置を直に書く処理（スローインの配置・ジャンプボール・交代の入場）は
//    デッドボール中に起きるので、ライブのモード（held/pass/loose/shot）だけを見る。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);
const LIVE = new Set(["held", "pass", "loose", "shot", "charge"]);

type Hit = { d: number; cap: number; mode: string; name: string; x: number; z: number;
  air: boolean; shoved: boolean; save: boolean; oob: boolean; reb: boolean };
const hits: Hit[] = [];
let frames = 0, samples = 0;
let shown = false, outShown = false;
const prev = new Map<Player, { x: number; z: number }>();

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  prev.clear();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    for (const p of game.players) prev.set(p, { x: p.pos.x, z: p.pos.z });
    game.update(DT);
    frames++;
    if (!LIVE.has(mode) || !LIVE.has(game.ballMode)) continue;
    for (const p of game.players) {
      const q = prev.get(p)!;
      // ⚠️ 「線の外へ出た瞬間」を捕まえる。引き戻し(ワープ)の原因は出た側にある。
      if (!outShown && Math.abs(q.x) <= 7.0 && Math.abs(p.pos.x) > 7.02) {
        outShown = true;
        console.log("[はみ出し] " + p.name + " x " + q.x.toFixed(2) + " → " + p.pos.x.toFixed(2)
          + " z " + p.pos.z.toFixed(2) + " mode " + mode + "→" + game.ballMode
          + " handler " + (game.handler === p) + " 受け手 " + (game.passTo === p)
          + " cutting " + p.cutting + " shakeOpen " + p.shakeOpenT.toFixed(2)
          + " spot " + p.spotIdx);
      }
      // 直前の状態を1件だけ詳しく出す
      const dd = Math.hypot(p.pos.x - q.x, p.pos.z - q.z);
      if (dd > 0.65 && !shown) {
        shown = true;
        console.log("[跳び " + (dd * 100).toFixed(0) + "cm] " + p.name + " team" + p.team
          + " 前(" + q.x.toFixed(2) + "," + q.z.toFixed(2) + ") → 後(" + p.pos.x.toFixed(2) + "," + p.pos.z.toFixed(2) + ")"
          + " mode " + mode + "→" + game.ballMode
          + " airborne " + p.airborne + " jumpT " + (p as unknown as { jumpT: number }).jumpT
          + " looseReactT " + p.looseReactT.toFixed(2)
          + " saveBy " + (game.saveBy === p) + " handler " + (game.handler === p)
          + " oobGrace " + p.oobGraceT.toFixed(2)
          + " 最寄り " + (() => { let b = 9; for (const q of game.players) if (q !== p) b = Math.min(b, Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z)); return b.toFixed(2); })());
      }
      const d = Math.hypot(p.pos.x - q.x, p.pos.z - q.z);
      samples++;
      // 1フレームで動ける上限。走る速さ + 接触で弾かれる分の余裕（×1.6）。
      const cap = p.runSpeed * DT * 1.6;
      if (d > cap) {
        // ⚠️ 何が飛ばしたのかを掴むため、そのときの状態も持つ。
        hits.push({ d, cap, mode, name: p.name, x: p.pos.x, z: p.pos.z,
          air: p.airborne, shoved: p.shovedT > 0, save: game.saveBy === p,
          oob: Math.abs(Math.abs(p.pos.x) - 7.0) < 0.01 || Math.abs(Math.abs(p.pos.z) - 13.5) < 0.01,
          reb: game.looseIsRebound });
      }
    }
  }
}
console.log(NG + "試合 / " + frames + "フレーム / ライブ中のサンプル " + samples.toLocaleString());
console.log("走れる以上に飛んだ回数: " + hits.length
  + "（" + (hits.length / Math.max(1, samples) * 100).toFixed(4) + "%）");
if (hits.length) {
  const top = [...hits].sort((a, b) => b.d / b.cap - a.d / a.cap).slice(0, 8);
  console.log("  大きい順8件（飛んだ距離 / 1フレームの上限）:");
  for (const h of top) {
    console.log("    " + (h.d * 100).toFixed(1) + "cm / 上限 " + (h.cap * 100).toFixed(1) + "cm"
      + " = " + (h.d / h.cap).toFixed(2) + "倍  " + h.mode
      + "  x" + h.x.toFixed(1) + " z" + h.z.toFixed(1));
  }
  const tag = (h: Hit): string => (h.air ? "空中 " : "") + (h.shoved ? "押され " : "")
    + (h.save ? "セーブ " : "") + (h.oob ? "ライン上 " : "") + (h.reb ? "リバウンド " : "");
  const byTag = new Map<string, number>();
  for (const h of hits) byTag.set(tag(h) || "(印なし)", (byTag.get(tag(h) || "(印なし)") ?? 0) + 1);
  console.log("  状態別: " + [...byTag].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => k + " " + n).join(" / "));
  // ⚠️ 上限を少し超えただけ（接触で弾かれた等）と、明らかな瞬間移動を分けて見る。
  const r = hits.map((h) => h.d / h.cap).sort((a, b) => a - b);
  const band = (lo: number, hi: number): number => r.filter((v) => v >= lo && v < hi).length;
  console.log("  超過の程度: 1.0〜1.5倍 " + band(1, 1.5) + " / 1.5〜2倍 " + band(1.5, 2)
    + " / 2〜3倍 " + band(2, 3) + " / 3倍以上 " + r.filter((v) => v >= 3).length);
  const byMode = new Map<string, number>();
  for (const h of hits) byMode.set(h.mode, (byMode.get(h.mode) ?? 0) + 1);
  console.log("  モード別: " + [...byMode].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => k + " " + n).join(" / "));
}
