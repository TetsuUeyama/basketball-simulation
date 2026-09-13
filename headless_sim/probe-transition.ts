// 守備へ戻るときの走り方を測る。中腰（後ろ歩き/横歩き）で戻っていないか、
// 自陣へ戻り切るまで何秒かかるか。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
// ⚠️ クリップ名(p.clipName)は見た目の sync でしか決まらず、26人ぶん組むと重すぎる。
//    pickClip と**同じ式**をここで再現して、どのモーションが選ばれるかだけを見る。
//    （胸の向きに対する速度の成分で 前 / 後ろ / 横 を決めている）
const MOVE_MIN = 0.06, DASH = 0.62;
function clipOf(p: Player): string {
  const frac = p.runSpeed > 0 ? Math.min(1, p.curSpd / p.runSpeed) : 0;
  if (frac < MOVE_MIN) return "idle";
  const ns = p.numberSide;
  const th = p.root.rotation.y + p.torsoTwist;
  const fx = -ns * Math.sin(th), fz = -ns * Math.cos(th);
  const along = p.velX * fx + p.velZ * fz;
  const side = p.velX * fz - p.velZ * fx;
  const dash = frac >= DASH;
  if (Math.abs(side) > Math.abs(along) * 1.2) return dash ? "sidestepDash" : "sidestep";
  if (along < 0) return dash ? "backdash" : "backwalk";
  return dash ? "run" : "walk";
}
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 2);

const clips = new Map<string, number>();
let transitF = 0;
const spds: number[] = [];
const backT: number[] = [];     // ポゼッション交代から自陣（z*s>0）へ戻るまで
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let cur = -1, t0 = 0;
  const home = new Map<Player, number>();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const t = i * DT;
    if (game.possession !== cur) { cur = game.possession; t0 = t; home.clear(); }
    const def = game.teamPlayers(1 - game.possession);
    const s = game.attackSign(game.possession);
    for (const p of def) {
      if (!home.has(p) && p.pos.z * s > 0.5) { home.set(p, t - t0); backT.push(t - t0); }
      if (p.transitT > 0) {
        transitF++;
        spds.push(p.curSpd / Math.max(1, p.runSpeed));
        const c = clipOf(p);
        clips.set(c, (clips.get(c) ?? 0) + 1);
      }
    }
  }
}
const tot = [...clips.values()].reduce((a, b) => a + b, 0) || 1;
console.log(NG + "試合 / 戻っている間のフレーム " + transitF);
console.log("戻っている間のモーション: " + [...clips].sort((a, b) => b[1] - a[1])
  .map(([k, n]) => k + " " + (n / tot * 100).toFixed(1) + "%").join(" / "));
const med = (a: number[]): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(2) : "-";
console.log("戻っている間の速さ（走る速さに対する割合）: 中央 "
  + (Number(med(spds)) * 100).toFixed(0) + "% / 全力(72%超)の割合 "
  + (spds.filter((v) => v > 0.72).length / Math.max(1, spds.length) * 100).toFixed(0) + "%");
console.log("自陣へ戻るまで: " + backT.length + "件 / 中央 " + med(backT) + "秒");
