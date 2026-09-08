// 守備側のジャンプは「いつ・なぜ」起きているか。ブロックにつながっているか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D } from "../src/util";
import { bestBlocker } from "../src/move/reaction/contest-block";
import { PALM_HITBOX } from "../src/config";
import { palmRadius } from "../src/eval";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);

const cause: Record<string, number> = {
  "シュートの溜め中": 0, "シュート飛翔中": 0, "ドリブル中の相手へ": 0,
  "ルーズボール": 0, "スローイン/その他": 0,
};
let shots = 0, blocks = 0, ftShots = 0, blkInc = 0;
let airAtRelease = 0, blockedWhenAir = 0, blockedWhenGround = 0, groundAtRelease = 0;
const gapAtJump: number[] = [];    // ドリブル中に跳んだとき、ハンドラーまでの距離
const blkP: number[] = [];         // リリース時のブロック確率
const nearD: number[] = [];        // リリース時、最寄り守備者までの距離
const rangeD: number[] = [];       // その守備者のブロック射程
let noCand = 0;
let driveJumpUseful = 0;           // ドリブル中に跳んで、そのジャンプ中に何か起きた
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const wasAir = new Map<Player, boolean>();
  const flying = new Map<Player, { cause: string; t: number; hit: boolean }>();
  let blk0 = 0;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    const off = game.possession;
    const before = game.players.reduce((s, p) => s + p.stats.blk, 0);
    game.update(DT);
    const after = game.players.reduce((s, p) => s + p.stats.blk, 0);
    if (after > before) { blkInc += after - before; for (const [, f] of flying) f.hit = true; }
    if (mode !== "shot" && game.ballMode === "shot") {
      shots++;
      const sh = game.shooter;
      if (sh) {
        const cand = bestBlocker(game.teamPlayers(1 - sh.team), sh, false, game.shotWindup, PALM_HITBOX);
        if (cand) blkP.push(cand.p); else noCand++;
        let nd = Infinity, ndp: Player | null = null;
        for (const q2 of game.teamPlayers(1 - sh.team)) {
          const dd = dist2D(q2.pos, sh.pos);
          if (dd < nd) { nd = dd; ndp = q2; }
        }
        nearD.push(nd);
        if (ndp) rangeD.push(PALM_HITBOX ? 1.05 * palmRadius(ndp, sh) : 1.7);
        const anyAir = game.players.some((p) => p.team !== sh.team && p.airborne
          && dist2D(p.pos, sh.pos) < 2.2);
        if (anyAir) airAtRelease++; else groundAtRelease++;
      }
    }
    if (mode !== "freethrow" && game.ballMode === "freethrow") ftShots++;
    for (const p of game.players) {
      const air = p.airborne, was = wasAir.get(p) ?? false;
      if (air && !was) {
        // 守備側だけ数える
        if (p.team !== off) {
          let c = "スローイン/その他";
          if (mode === "charge") c = "シュートの溜め中";
          else if (mode === "shot") c = "シュート飛翔中";
          else if (mode === "loose" || mode === "tipoff") c = "ルーズボール";
          else if (mode === "held" && game.handler) {
            c = "ドリブル中の相手へ";
            gapAtJump.push(dist2D(p.pos, game.handler.pos));
          }
          cause[c]++;
          flying.set(p, { cause: c, t: 0, hit: false });
        }
      }
      if (!air && was) {
        const f = flying.get(p);
        if (f) {
          if (f.cause === "ドリブル中の相手へ" && f.hit) driveJumpUseful++;
          flying.delete(p);
        }
      }
      wasAir.set(p, air);
    }
    void blk0;
  }
  blocks += game.players.reduce((s, p) => s + p.stats.blk, 0);
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(2) : "-";
const tot = Object.values(cause).reduce((a, b) => a + b, 0);
console.log(`${NG} 試合 / ジャンプショット ${shots} 本 / フリースロー ${ftShots} 本 / ブロック ${blocks} 本`);
console.log(`\n守備側のジャンプ ${tot} 回の内訳`);
for (const [k, v] of Object.entries(cause)) {
  console.log(`  ${k.padEnd(16, "　")} ${String(v).padStart(5)}  ${(v / Math.max(1, tot) * 100).toFixed(0)}%`);
}
console.log(`\nシュートが放たれた瞬間、2.2m 以内に守備者が跳んでいた ${airAtRelease} 本 / 跳んでいなかった ${groundAtRelease} 本`);
console.log(`ブロック（毎フレーム数えた実数） ${blkInc} 本 / 試合あたり ${(blkInc / NG).toFixed(2)} 本`);
console.log(`ブロック率 ${(blkInc / Math.max(1, shots + blkInc) * 100).toFixed(1)}%（跳んだシュート＋ブロックされた分に対して）`);
console.log(`
リリース時の判定`);
console.log(`  ブロック候補が居なかった ${noCand} 本 / 居た ${blkP.length} 本`);
console.log(`  候補が居たときのブロック確率 中央 ${q(blkP, .5)}  75% ${q(blkP, .75)}  95% ${q(blkP, .95)}`);
console.log(`  最寄り守備者までの距離 中央 ${q(nearD, .5)}m / その守備者のブロック射程 中央 ${q(rangeD, .5)}m`);
console.log(`\nドリブル中に跳んだとき、ハンドラーまでの距離 中央 ${q(gapAtJump, .5)}m  75% ${q(gapAtJump, .75)}m`);
console.log(`ドリブル中のジャンプ ${cause["ドリブル中の相手へ"]} 回のうち、その滞空中にブロックが記録された ${driveJumpUseful} 回`);
void blockedWhenAir; void blockedWhenGround;
