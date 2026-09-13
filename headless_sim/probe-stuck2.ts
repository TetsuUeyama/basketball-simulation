// 「走っているのに進まない」選手を1人捕まえて、**誰がどこへ動かしているか**を毎フレーム並べる。
// ⚠️ 推測で直す前に、移動を命じている呼び出し元を実際に見る（util.ts の MOVE_TRACE）。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { MOVE_LOG, MOVE_TRACE } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
MOVE_TRACE.on = true;

type W = { x: number[]; z: number[]; v: number[] };
const win = new Map<Player, W>();
let shown = 0;

const pairs = new Map<string, number>();
for (let gi = 0; gi < 2 && shown < 10; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  win.clear();
  for (let i = 0; i < 60 * 60 * 4 && shown < 10; i++) {
    for (const a of MOVE_LOG.values()) a.length = 0;
    game.update(DT);
    for (const p of game.players) {
      let w = win.get(p);
      if (!w) { w = { x: [], z: [], v: [] }; win.set(p, w); }
      w.x.push(p.pos.x); w.z.push(p.pos.z); w.v.push(p.curSpd);
      if (w.x.length > 90) { w.x.shift(); w.z.shift(); w.v.shift(); }
      if (w.x.length < 90) continue;
      const net = Math.hypot(w.x[89] - w.x[0], w.z[89] - w.z[0]);
      const span = Math.hypot(Math.max(...w.x) - Math.min(...w.x), Math.max(...w.z) - Math.min(...w.z));
      const avg = w.v.reduce((a, b) => a + b, 0) / w.v.length;
      if (!(net < 0.3 && span < 0.8 && avg > 1.5)) continue;
      // 見つけた。この選手を 20 フレーム追って、動かしている場所の組み合わせを数える。
      shown++;
      const mode0 = game.ballMode;
      const sites = new Map<string, number>();
      const tzs: number[] = [];
      for (let k = 0; k < 20; k++) {
        for (const a of MOVE_LOG.values()) a.length = 0;
        game.update(DT);
        for (const l of MOVE_LOG.get(p.pos) ?? []) {
          sites.set(l.site, (sites.get(l.site) ?? 0) + 1);
          tzs.push(l.tz);
        }
      }
      const key = mode0 + " | " + [...sites.keys()].sort().join(" + ")
        + " | 目標z " + (tzs.length ? Math.min(...tzs).toFixed(1) + "〜" + Math.max(...tzs).toFixed(1) : "-");
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
      win.clear();
      break;
    }
  }
}
MOVE_TRACE.on = false;
console.log("捕まえた " + shown + "件の内訳（モード | 動かしている場所 | 目標zの幅）");
for (const [k, n2] of [...pairs].sort((a, b) => b[1] - a[1])) console.log("  " + n2 + "件  " + k);
