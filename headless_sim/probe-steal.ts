// スティールの突き: 溜め(引き)→上半身の回転→腕の伸び、の順になっているか。
// 手がどこまで届くか（リーチ）も測る。
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
const NG = Number(process.env.NG ?? 6);

// 手の水平リーチ = 手首ノードのワールド位置と、選手の足元との水平距離
function handReach(p: Player, right: boolean): number {
  const n = right ? p.wristR : p.wristL;
  n.computeWorldMatrix(true);
  const w = n.getAbsolutePosition();
  return Math.hypot(w.x - p.pos.x, w.z - p.pos.z);
}
/** 手首が「ボールの向きへ」どれだけ出ているか(m)。これが突きのリーチ。 */
function reachToward(p: Player, right: boolean, bx: number, bz: number): number {
  const n = right ? p.wristR : p.wristL;
  n.computeWorldMatrix(true);
  const w = n.getAbsolutePosition();
  const ux = bx - p.pos.x, uz = bz - p.pos.z, ul = Math.hypot(ux, uz) || 1;
  return ((w.x - p.pos.x) * ux + (w.z - p.pos.z) * uz) / ul;
}
type Rec = { twist: number[]; lean: number[]; reach: number[]; lunge: number[]; gap: number[] };
const recs: Rec[] = [];
const cur = new Map<Player, Rec>();
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    for (const p of game.players) {
      if (p.stealReachT <= 0 || p.airborne) { const r = cur.get(p); if (r) { recs.push(r); cur.delete(p); } continue; }
      let r = cur.get(p);
      if (!r) { r = { twist: [], lean: [], reach: [], lunge: [], gap: [] }; cur.set(p, r); }
      const b = game.ball.pos;
      const fx = b.x - p.pos.x, fz = b.z - p.pos.z, fl = Math.hypot(fx, fz) || 1;
      r.twist.push(p.torsoTwist);
      r.lunge.push(p.lungeD);
      r.gap.push(game.handler ? Math.hypot(p.pos.x - game.handler.pos.x, p.pos.z - game.handler.pos.z) : NaN);
      r.lean.push((p.digLeanX * fx + p.digLeanZ * fz) / fl);   // 的の向きへの踏み込み(+)
      r.reach.push(Math.max(reachToward(p, true, b.x, b.z), reachToward(p, false, b.x, b.z)));
    }
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(3) : "-";
const first = (r: Rec): number => r.reach[0] ?? 0;
const useful = recs.filter((r) => r.twist.length >= 4);
console.log(`${NG} 試合  スティールの突き ${useful.length} 回（4フレーム以上）`);
console.log(`  溜めの引き(踏み込みの最小値、負なら後ろへ引いている) 中央 ${q(useful.map((r) => Math.min(...r.lean)), .5)}`);
console.log(`  突きの踏み込み(最大値) 中央 ${q(useful.map((r) => Math.max(...r.lean)), .5)}`);
console.log(`  胴のツイスト 最小 ${q(useful.map((r) => Math.min(...r.twist)), .5)} → 最大 ${q(useful.map((r) => Math.max(...r.twist)), .5)}`);
console.log(`  手のリーチ 開始 ${q(useful.map(first), .5)}m → 最大 ${q(useful.map((r) => Math.max(...r.reach)), .5)}m`);
console.log(`  ※ リーチは「手首がボールの向きへ何m出たか」`);
console.log(`  踏み込みステップ 最大 ${q(useful.map((r) => Math.max(...r.lunge)), .5)}m  マークとの距離 ${q(useful.map((r) => Math.max(...r.gap.filter((x) => !isNaN(x)))), .5)}m → ${q(useful.map((r) => Math.min(...r.gap.filter((x) => !isNaN(x)))), .5)}m`);
console.log(`  逆へ引いてから突いた割合 ${(useful.filter((r) => Math.min(...r.lean) < -0.005 && Math.max(...r.lean) > 0.05).length / Math.max(1, useful.length) * 100).toFixed(0)}%`);
