// 反動動作が実際にボール(＝追従する両手)を「投げる方向と逆」へ動かしているか。
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

const pullP: number[] = [], holdP: number[] = [], dropP: number[] = [];
const pullS: number[] = [], holdS: number[] = [], dropS: number[] = [];
type Rec = { tx: number; tz: number; x0: number; z0: number; y0: number; along: number[]; y: number[]; px: number; py: number; pz: number; jump: number };
let rec: Rec | null = null;
let store: "pass" | "shot" | null = null;
const jumps: number[] = [];   // 1フレームでのボールの最大移動(瞬間移動の検出)
const loY: number[] = [], hiY: number[] = [], relY: number[] = [];
const close = (): void => {
  if (!rec || !store) { rec = null; store = null; return; }
  // 投げる方向への射影。最小値(= 最も引いた量) と、引き切ってから動かない時間。
  const pull = -Math.min(...rec.along);
  const drop = -Math.min(...rec.y);
  let hold = 0;
  for (let i = 1; i < rec.along.length; i++) {
    if (Math.abs(rec.along[i] - rec.along[i - 1]) < 0.004) hold += DT; else hold = 0;
  }
  jumps.push(rec.jump);
  if (store === "shot") {
    const ys = rec.y.map((v) => v + rec!.y0);
    loY.push(Math.min(...ys)); hiY.push(ys[ys.length - 1]);
  }
  const P = store === "pass";
  (P ? pullP : pullS).push(pull);
  (P ? holdP : holdS).push(hold);
  (P ? dropP : dropS).push(drop);
  rec = null; store = null;
};
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const gg = game as unknown as { pendingPassTo: Player | null; pendingPassWind: boolean; chargeShooter: Player | null };
    const wind = !!gg.pendingPassTo && gg.pendingPassWind && !!game.handler;
    const w0 = (game as unknown as { windBallY: number }).windBallY;
    const chg = game.ballMode === "charge" && !!gg.chargeShooter;
    if ((!wind && !chg) || w0 < 0) { if (!wind && !chg) close(); continue; }
    const b = game.ball.pos;
    if (!rec) {
      const t = wind ? gg.pendingPassTo!.pos : game.attackFloor(gg.chargeShooter!.team);
      // 起点は「溜めを始めた瞬間のボール位置」。観測1フレーム目ではもう動き始めている。
      const w = game as unknown as { windBallX: number; windBallY: number; windBallZ: number };
      const h = wind ? game.handler! : gg.chargeShooter!;
      rec = { tx: t.x, tz: t.z, x0: h.pos.x + w.windBallX, z0: h.pos.z + w.windBallZ, y0: w.windBallY,
        along: [], y: [], px: b.x - h.pos.x, py: b.y, pz: b.z - h.pos.z, jump: 0 };
      store = wind ? "pass" : "shot";
    }
    const dx = rec.tx - rec.x0, dz = rec.tz - rec.z0, l = Math.hypot(dx, dz) || 1;
    rec.along.push(((b.x - rec.x0) * dx + (b.z - rec.z0) * dz) / l);
    rec.y.push(b.y - rec.y0);
    // 保持者から見た動き。走っていれば体ごと動くので、それを引かないと飛びに見える。
    const hp = wind ? game.handler! : gg.chargeShooter!;
    const rx = b.x - hp.pos.x, rz = b.z - hp.pos.z;
    rec.jump = Math.max(rec.jump, Math.hypot(rx - rec.px, b.y - rec.py, rz - rec.pz));
    rec.px = rx; rec.py = b.y; rec.pz = rz;
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(3) : "-";
const line = (nm: string, pu: number[], ho: number[], dr: number[]): void => console.log(
  `  ${nm} ${pu.length} 回  引いた量 中央 ${q(pu, .5)}m (75% ${q(pu, .75)}m)`
  + `  沈み ${q(dr, .5)}m  引き切ってからの静止 ${q(ho, .5)}秒`);
console.log(`${NG} 試合  投げる方向を + とした、溜め中のボール(＝追従する両手)の動き`);
line("パス", pullP, holdP, dropP);
line("シュート", pullS, holdS, dropS);
console.log(`  1フレームでのボールの飛び 中央 ${q(jumps, .5)}m  95% ${q(jumps, .95)}m（瞬間移動していないか）`);
console.log(`
シュートの溜め: 最低点 中央 ${q(loY, .5)}m / 構え終わりの高さ 中央 ${q(hiY, .5)}m / リリース高さ 中央 ${q(relY, .5)}m`);
