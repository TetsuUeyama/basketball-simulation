// 加速の反動: 体がどれだけ傾くか、切り返し/急停止で「進行方向と逆」へ倒れているか。
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
const ACC_TILT = 0.015, ACC_TILT_MAX = 0.16, PLANT_TILT = 0.23;   // player-visual.ts と同じ値

const deg: number[] = [];        // 動いている選手の傾き(度)
const plantDeg: number[] = [];   // プラント(切り返し/急停止)中の傾き
const plantAng: number[] = [];   // プラント中の「傾き」と「進行方向」の角度差(度)
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    for (const p of game.players) {
      if (p.seated || p.airborne) continue;
      const sp = Math.hypot(p.velX, p.velZ);
      if (sp < 0.5) continue;
      // sync() と同じ合成: 加速の傾き + プラントの踏ん張り
      const al = Math.hypot(p.accX, p.accZ);
      let lx = 0, lz = 0;
      if (al > 0.5) { const gg = Math.min(al * ACC_TILT, ACC_TILT_MAX) / al; lx = p.accX * gg; lz = p.accZ * gg; }
      if (p.plantT > 0 && p.plantDur > 0) {
        const k = (p.plantT / p.plantDur) * PLANT_TILT;
        lx -= p.plantDirX * k; lz -= p.plantDirZ * k;
      }
      const ll = Math.hypot(lx, lz);
      const t = ll * 180 / Math.PI;
      deg.push(t);
      if (p.plantT > 0 && ll > 1e-4) {
        plantDeg.push(t);
        const cs = (lx * p.velX + lz * p.velZ) / (ll * sp);
        plantAng.push(Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI);
      }
    }
  }
}
const q = (a: number[], f: number): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(1) : "-";
console.log(`${NG} 試合  動いている選手 ${deg.length} 標本`);
console.log(`  体の傾き 中央 ${q(deg, .5)}° / 75% ${q(deg, .75)}° / 95% ${q(deg, .95)}°`);
console.log(`  プラント(切り返し・急停止)中 ${plantDeg.length} 標本  傾き 中央 ${q(plantDeg, .5)}° / 95% ${q(plantDeg, .95)}°`);
console.log(`  その傾きと進行方向の角度差 中央 ${q(plantAng, .5)}° / 25% ${q(plantAng, .25)}°（90°超＝後ろへ踏ん張っている）`);
