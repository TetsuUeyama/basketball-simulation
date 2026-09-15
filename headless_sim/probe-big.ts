// ビッグ(PF/C)が、どこに立ち・どこから打っているか。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
import { THREE_DIST } from "../src/config";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 8);

type S = { n: number; three: number; rim: number; sumD: number; acc: number };
const shots: Record<string, S> = {};
const pos: Record<string, { n: number; rim: number; arc: number; post: number; anchor: number; sumD: number }> = {};
const mk = (r: string) => { shots[r] ??= { n: 0, three: 0, rim: 0, sumD: 0, acc: 0 }; pos[r] ??= { n: 0, rim: 0, arc: 0, post: 0, anchor: 0, sumD: 0 }; };
for (const r of ["PG", "SG", "SF", "PF", "C"]) mk(r);
let lastShooter: Player | null = null;
const why = new Map<string, number>();

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    const before = game.shooter;
    game.update(DT);
    const sh = game.shooter;
    if (sh && sh !== before && sh !== lastShooter) {
      lastShooter = sh;
      const d = dist2D(sh.pos, game.attackFloor(sh.team));
      const s = shots[sh.role]; if (s) {
        s.n++; s.sumD += d; s.acc += sh.attr.threeAcc;
        if (d > THREE_DIST) s.three++;
        if (d < 3.0) s.rim++;
      }
    }
    if (!sh) lastShooter = null;
    if (i % 30 || !game.frontT) continue;
    const t = game.possession;
    for (const p of game.teamPlayers(t)) {
      if (p === game.handler) continue;
      const a = pos[p.role]; if (!a) continue;
      const d = dist2D(p.pos, game.attackFloor(t));
      a.n++;
      if (d < 3.5) a.rim++;
      if (d > THREE_DIST) {
        a.arc++;
        // ⚠️ ビッグが外に居る「理由」を分類する。合わせて対策の当て先を決める。
        if (p.role === "PF" || p.role === "C") {
          const k = p.screening ? "スクリーン" : p.cutting ? "カット中"
            : p.spotIdx < 5 ? `外のスポット(idx${p.spotIdx})を持っている`
            : p.shakeOpenT > 0 ? "マーク外し中"
            : "ポストのスポットを持つが外に居る";
          why.set(k, (why.get(k) ?? 0) + 1);
        }
      }
      a.sumD += d;
      if (p.spotIdx >= 5) a.post++;
      if (game.postAnchor(t) === p) a.anchor++;
    }
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  (3Pライン ${THREE_DIST}m)`);
console.log("\n■ 立ち位置（攻撃中・ハンドラー以外）");
for (const r of ["PG", "SG", "SF", "PF", "C"]) {
  const a = pos[r];
  console.log(`  ${r}: 平均 ${(a.sumD / Math.max(1, a.n)).toFixed(2)}m / ゴール下3.5m内 ${pc(a.rim, a.n)} / 3Pラインより外 ${pc(a.arc, a.n)}`
    + ` / ポストのスポット(5,6) ${pc(a.post, a.n)} / アンカー役 ${pc(a.anchor, a.n)}`);
}
console.log("\n■ シュート");
for (const r of ["PG", "SG", "SF", "PF", "C"]) {
  const s = shots[r];
  console.log(`  ${r}: ${s.n}本 / 平均距離 ${(s.sumD / Math.max(1, s.n)).toFixed(2)}m`
    + ` / 3P ${pc(s.three, s.n)} / ゴール下(3m内) ${pc(s.rim, s.n)}`
    + ` / 平均3P精度 ${(s.acc / Math.max(1, s.n)).toFixed(0)}`);
}
