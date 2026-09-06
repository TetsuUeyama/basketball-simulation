// リバウンドが確保できているかを実測する。
// 確保の条件（looseball.resolveLooseContact）は
//   ・水平距離 0.6m 以内  ・0.3m < ボールの高さ < その選手の最大リーチ
// なので、落ちているのが「位置取り」か「高さ（ジャンプ）」かを切り分ける。
import "./stubs";
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2DTo } from "../src/util";

const engine = new NullEngine();
const scene = new Scene(engine);
const hoops = buildCourt(scene);
const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const DT = 1 / 60;
const g = game as unknown as { applyRoster(): void; reset(): void };

type Ep = {
  frames: number; minHoriz: number; minHorizInBand: number; everInBand: boolean;
  everJumped: boolean; maxJump: number; secured: boolean; tips: number;
  ballTop: number; reachTop: number;
};
const eps: Ep[] = [];
let cur: Ep | null = null;

for (let gi = 0; gi < 4; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 3) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    game.update(DT);
    const loose = game.ballMode === "loose"
      && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
    if (!loose) {
      if (cur) { eps.push(cur); cur = null; }
      continue;
    }
    if (!cur) {
      cur = { frames: 0, minHoriz: 99, minHorizInBand: 99, everInBand: false,
        everJumped: false, maxJump: 0, secured: false, tips: 0,
        ballTop: 0, reachTop: 0 };
    }
    cur.frames++;
    const b = game.ball.pos;
    cur.ballTop = Math.max(cur.ballTop, b.y);
    for (const p of game.players) {
      const h = dist2DTo(b, p.pos.x, p.pos.z);
      if (h < cur.minHoriz) cur.minHoriz = h;
      const top = p.reachTopY();
      cur.reachTop = Math.max(cur.reachTop, top);
      if (p.jumpY() > 0.02) { cur.everJumped = true; cur.maxJump = Math.max(cur.maxJump, p.jumpY()); }
      if (b.y > 0.3 && b.y < top) {
        cur.everInBand = true;
        if (h < cur.minHorizInBand) cur.minHorizInBand = h;
      }
    }
  }
  if (cur) { eps.push(cur); cur = null; }
}

const n = eps.length;
const avg = (f: (e: Ep) => number): string => (eps.reduce((s, e) => s + f(e), 0) / n).toFixed(2);
const cnt = (f: (e: Ep) => boolean): number => eps.filter(f).length;
console.log(`リバウンドの場面 ${n} 回（4試合ぶん）`);
console.log(`  続いたフレーム数の平均 ${avg((e) => e.frames)}（${(Number(avg((e) => e.frames)) / 60).toFixed(2)}秒）`);
console.log(`  ボールの最高点の平均   ${avg((e) => e.ballTop)}m`);
console.log(`  誰かの最大リーチの平均 ${avg((e) => e.reachTop)}m`);
console.log(`  誰かがジャンプした     ${cnt((e) => e.everJumped)} / ${n} 回（跳んだ高さの平均 ${avg((e) => e.maxJump)}m）`);
console.log(`  「届く高さの帯」に入った ${cnt((e) => e.everInBand)} / ${n} 回`);
console.log(`  一番寄れた水平距離の平均         ${avg((e) => e.minHoriz)}m`);
console.log(`  そのうち「届く高さの帯」内での平均 ${avg((e) => (e.everInBand ? e.minHorizInBand : 0))}m`);
console.log(`  水平 0.6m 以内まで寄れた回数     ${cnt((e) => e.minHorizInBand <= 0.6)} / ${n}`);

// 結果の内訳: 最初の接触が確保か弾きか、何回弾いてから収まったか
console.log("");
console.log("リバウンドの結果");
{
  let ep = 0, tips = 0, secured = 0, floor = 0, firstSecure = 0;
  let inTip = false, tipCount = 0, sawContact = false;
  for (let gi = 0; gi < 4; gi++) {
    clubTeam(0, (gi + 1) % 8); clubTeam(1, (gi + 5) % 8);
    g.applyRoster(); g.reset();
    let prevMode = game.ballMode, prevTips = 0, hitFloor = false;
    for (let i = 0; i < 60 * 60 * 4; i++) {
      game.update(DT);
      const reb = game.ballMode === "loose"
        && (game as unknown as { looseIsRebound: boolean }).looseIsRebound;
      const lt = (game as unknown as { looseTips: number }).looseTips;
      if (reb) {
        if (!inTip) { inTip = true; ep++; tipCount = 0; sawContact = false; hitFloor = false; prevTips = lt; }
        if (lt > prevTips) { tipCount += lt - prevTips; prevTips = lt; sawContact = true; }
        if (game.ball.pos.y < 0.35) hitFloor = true;
      } else if (inTip) {
        inTip = false;
        tips += tipCount;
        if (prevMode === "loose") { /* 直前まで loose */ }
        if (tipCount === 0) firstSecure++;
        if (hitFloor) floor++;
        secured++;
      }
      prevMode = game.ballMode;
    }
  }
  console.log(`  リバウンドの場面 ${ep} 回`);
  console.log(`  最初の接触で確保できた   ${firstSecure} 回 (${(firstSecure / ep * 100).toFixed(0)}%)`);
  console.log(`  弾いた回数の合計         ${tips} 回（1場面あたり ${(tips / ep).toFixed(1)} 回）`);
  console.log(`  途中でボールが床まで落ちた ${floor} 回 (${(floor / ep * 100).toFixed(0)}%)`);
}
