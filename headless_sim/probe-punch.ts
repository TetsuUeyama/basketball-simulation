// 突きの検証: 左右のパタつき / 水平に出ているか / 逆手が前に出ていないか。
// ⚠️ numberSide は両方（+1 / -1）試す。片方だけだと前後・左右の符号ミスを取りこぼす。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { STEAL, stepLunge } from "../src/ai/defense/vs-onball";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
const DT = 1 / 60;
const BY = 0.95, GAP = 1.05;

function run(ns: number, verbose: boolean): void {
  const p = game.players[ns > 0 ? 0 : 1];
  p.setNumberSide(ns);
  p.pos.set(0, 0, 0);
  p.root.rotation.y = 0;
  p.stand(); p.sync();
  // 体の正面（locomotion と同じ規約: 胸の向き = -numberSide·Z）
  const th = p.root.rotation.y;
  const fx = Math.sin(th) * -ns, fz = Math.cos(th) * -ns;
  const BX = fx * GAP, BZ = fz * GAP;
  const target = new Vector3(BX, BY, BZ);
  /** 手首が体の正面方向へどれだけ出たか(m)。 */
  const proj = (n: { computeWorldMatrix(f: boolean): unknown; getAbsolutePosition(): { x: number; y: number; z: number } }):
    { fwd: number; y: number } => {
    n.computeWorldMatrix(true);
    const w = n.getAbsolutePosition();
    return { fwd: (w.x - p.pos.x) * fx + (w.z - p.pos.z) * fz, y: w.y };
  };
  const rest = proj(p.punchRight ? p.wristL : p.wristR).fwd;
  let shLead = 0, shBack = 0;
  p.beginAction("steal", STEAL.windup, STEAL.active, STEAL.cooldown);
  let flips = 0, prev = -1, backMax = -9, leadYLo = 9, leadYHi = -9, fireLead = 0, t = 0;
  const rows: string[] = [];
  for (let i = 0; i < 80 && (p.actPhase || i === 0); i++) {
    p.lastDt = DT;
    const wasWind = p.actPhase === "windup";
    p.tickAction(DT);
    stepLunge(p, BX, BZ, 9);
    if (p.actPhase) p.digReach(target);
    p.sync();
    const right = p.punchRight ? 1 : 0;
    if (prev >= 0 && right !== prev) flips++;
    prev = right;
    const lead = proj(p.punchRight ? p.wristR : p.wristL);
    const back = proj(p.punchRight ? p.wristL : p.wristR);
    backMax = Math.max(backMax, back.fwd);
    if (lead.fwd > 0.25) { leadYLo = Math.min(leadYLo, lead.y); leadYHi = Math.max(leadYHi, lead.y); }
    if (wasWind && p.actPhase !== "windup") {
      fireLead = lead.fwd;   // 当たるフレーム
      shLead = proj(p.punchRight ? p.armPivotR : p.armPivotL).fwd;
      shBack = proj(p.punchRight ? p.armPivotL : p.armPivotR).fwd;
    }
    if (verbose && i % 3 === 0) {
      rows.push(`  ${t.toFixed(3)}s ${(p.actPhase || "-").padEnd(8)} 突く手 前${lead.fwd.toFixed(3)} 高${lead.y.toFixed(3)}`
        + `  逆手 前${back.fwd.toFixed(3)}  ツイスト ${p.torsoTwist.toFixed(3)}  踏込 ${p.lungeD.toFixed(3)}`);
    }
    t += DT;
  }
  if (verbose) console.log(rows.join("\n"));
  console.log(`  numberSide=${ns > 0 ? "+1" : "-1"}  左右の入れ替わり ${flips} 回（0が正しい）`);
  console.log(`    当たるフレームでの突く手 ${fireLead.toFixed(3)}m（伸び切っているか）`);
  console.log(`    突く手の高さ ${leadYLo.toFixed(3)}〜${leadYHi.toFixed(3)}m（的 ${BY}m / 幅が小さいほど水平）`);
  console.log(`    当たるフレームの肩 突く側 ${shLead.toFixed(3)}m / 逆側 ${shBack.toFixed(3)}m`
    + `（突く側が前＝差 ${(shLead - shBack).toFixed(3)}m が正）`);
  console.log(`    逆手の最前 ${backMax.toFixed(3)}m（静止時 ${rest.toFixed(3)}m 以下なら前に出ていない）`);
}
console.log("突き1回（正面 1.05m・高さ 0.95m のボールへ）");
run(1, true);
run(-1, false);
