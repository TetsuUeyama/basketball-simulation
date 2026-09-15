// ① センターがどこに居るか（リムからの距離／ペイント滞在率）
// ② 移動中にコートの横幅をどれだけ使えているか（|x| の分布）
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
const NG = Number(process.env.NG ?? 6);

type Acc = { n: number; rim: number; paint: number; post: number };
const mk = (): Acc => ({ n: 0, rim: 0, paint: 0, post: 0 });
const byRole: Record<string, Acc> = { PG: mk(), SG: mk(), SF: mk(), PF: mk(), C: mk() };
// 移動中(速度2m/s超)の |x| ヒストグラム。コート半幅は約7.0m
const BINS = [0, 1.5, 3.0, 4.5, 6.0, 99];
const movOff = new Array(BINS.length - 1).fill(0);
const movDef = new Array(BINS.length - 1).fill(0);
let movOffN = 0, movDefN = 0;
// トランジション中(自陣<->敵陣を移動、リムから9m超)だけの |x|
const trans = new Array(BINS.length - 1).fill(0);
let transN = 0;
const put = (arr: number[], x: number) => {
  for (let i = 0; i < BINS.length - 1; i++) if (x >= BINS[i] && x < BINS[i + 1]) { arr[i]++; return; }
};

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (i % 10) continue;
    const off = game.possession;
    for (let t = 0; t < 2; t++) for (const p of game.teamPlayers(t)) {
      const atk = game.attackFloor(t);
      const own = game.attackFloor(1 - t);
      // ① 攻撃中のロール別 位置
      if (t === off) {
        const a = byRole[p.role]; if (a) {
          const d = dist2D(p.pos, atk);
          a.n++; a.rim += d;
          if (Math.abs(p.pos.x - atk.x) < 2.45 && d < 6) a.paint++;
          if (d < 3.5) a.post++;
        }
      }
      // ② 移動中の横位置
      const sp = Math.hypot(p.velX, p.velZ);
      if (sp > 2.0) {
        const ax = Math.abs(p.pos.x);
        if (t === off) { put(movOff, ax); movOffN++; } else { put(movDef, ax); movDefN++; }
        if (dist2D(p.pos, atk) > 9 && dist2D(p.pos, own) > 9) { put(trans, ax); transN++; }
      }
    }
  }
}
const pc = (n: number, d: number) => (n / Math.max(1, d) * 100).toFixed(1) + "%";
console.log(`${NG}試合  (ペイントは半幅2.45mで判定)`);
console.log("\n① 攻撃中のロール別 位置:");
for (const r of ["PG", "SG", "SF", "PF", "C"]) {
  const a = byRole[r];
  console.log(`  ${r}: リムからの平均 ${(a.rim / Math.max(1, a.n)).toFixed(2)}m`
    + ` / ペイント内 ${pc(a.paint, a.n)} / ゴール下3.5m内 ${pc(a.post, a.n)}`);
}
const row = (nm: string, arr: number[], n: number) => {
  const cells = arr.map((v, i) => `${BINS[i]}〜${BINS[i + 1] === 99 ? "7.0" : BINS[i + 1]}m ${pc(v, n)}`);
  console.log(`  ${nm} (${n}件): ${cells.join(" | ")}`);
};
console.log("\n② 移動中(2m/s超)の コート中心からの横距離 |x|:");
row("攻撃側", movOff, movOffN);
row("守備側", movDef, movDefN);
row("トランジション中", trans, transN);
