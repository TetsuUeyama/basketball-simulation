// 守備のジャンプとブロックの効き、そして得点への影響。
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
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);

const cause: Record<string, number> = {
  charge: 0, shot: 0, drive: 0, loose: 0, other: 0,
};
let shots = 0, blk = 0, pts = 0, fgm = 0, fga = 0;
// 身長帯ごとの「シュートを選んだ回数」と「ブロックされた回数」
const bySize: Record<string, { shot: number; blocked: number }> = {
  low: { shot: 0, blocked: 0 }, mid: { shot: 0, blocked: 0 }, high: { shot: 0, blocked: 0 },
};
const bucket = (h: number): string => h < 1.78 ? "low" : h < 1.86 ? "mid" : "high";
// ブロックした側の身長・ジャンプ
const blkH: number[] = [], blkJ: number[] = [];

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  const wasAir = new Map<Player, boolean>();
  const prevBlk = new Map<Player, number>();
  for (const p of game.players) prevBlk.set(p, 0);
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const mode = game.ballMode;
    const off = game.possession;
    const shooter = game.chargeShooter ?? game.shooter;
    game.update(DT);
    for (const p of game.players) {
      const b = p.stats.blk, was = prevBlk.get(p) ?? 0;
      if (b > was) {
        blk += b - was;
        blkH.push(p.height); blkJ.push(p.attr.jump);
        if (shooter) bySize[bucket(shooter.height)].blocked++;
      }
      prevBlk.set(p, b);
    }
    if (mode !== "shot" && game.ballMode === "shot") shots++;
    if (mode !== "charge" && game.ballMode === "charge" && game.chargeShooter) {
      bySize[bucket(game.chargeShooter.height)].shot++;
    }
    for (const p of game.players) {
      const air = p.airborne, w = wasAir.get(p) ?? false;
      if (air && !w && p.team !== off) {
        if (mode === "charge") cause.charge++;
        else if (mode === "shot") cause.shot++;
        else if (mode === "loose" || mode === "tipoff") cause.loose++;
        else if (mode === "held" && game.handler) cause.drive++;
        else cause.other++;
      }
      wasAir.set(p, air);
    }
  }
  pts += game.score[0] + game.score[1];
  fgm += game.players.reduce((s, p) => s + p.stats.fgm, 0);
  fga += game.players.reduce((s, p) => s + p.stats.fga, 0);
}
void dist2D;
const avg = (a: number[]): string => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "-";
const tot = Object.values(cause).reduce((a, b) => a + b, 0);
console.log(`${NG} 試合（各4分）`);
console.log(`守備側のジャンプ ${tot} 回: 溜め中 ${cause.charge} / 飛翔中 ${cause.shot}`
  + ` / ドリブル中の相手へ ${cause.drive} / ルーズ ${cause.loose} / その他 ${cause.other}`);
console.log(`ブロック ${blk} 本（試合あたり ${(blk / NG).toFixed(2)} 本）`);
console.log(`跳んだシュート ${shots} 本に対して ${(blk / Math.max(1, shots + blk) * 100).toFixed(1)}%`);
console.log(`1試合あたり 得点 ${(pts / NG).toFixed(1)} / 成功 ${(fgm / NG).toFixed(1)} / 試投 ${(fga / NG).toFixed(1)}`
  + `（成功率 ${(fgm / Math.max(1, fga) * 100).toFixed(0)}%）`);
console.log(`\nブロックした側の 身長 平均 ${avg(blkH)}m / ジャンプ 平均 ${avg(blkJ)}`);
console.log(`\nシューターの身長帯ごと（シュートを選んだ回数 → うちブロックされた）`);
for (const [k, lab] of [["low", "〜1.78m"], ["mid", "1.78〜1.86m"], ["high", "1.86m〜"]] as [string, string][]) {
  const c = bySize[k];
  console.log(`  ${lab.padEnd(12, "　")} ${String(c.shot).padStart(4)} 回 → ${c.blocked} 本`
    + `（${(c.blocked / Math.max(1, c.shot) * 100).toFixed(0)}%）`);
}
