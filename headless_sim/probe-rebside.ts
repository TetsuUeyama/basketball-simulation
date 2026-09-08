// リバウンドの攻守差。反応遅れ・確保率・競りに行く人数を、攻撃側/守備側で比べる。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2D, dist2DTo } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 12);
type G2 = Game & { looseIsRebound: boolean; looseOff: number };

const lagOff: number[] = [], lagDef: number[] = [];
const nearOff: number[] = [], nearDef: number[] = [];   // 開始時にリム 4m 以内に居た人数
let off = 0, def = 0, none = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasReb = false, side = 0;
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const gg = game as G2;
    const reb = game.ballMode === "loose" && gg.looseIsRebound;
    if (reb && !wasReb) {
      side = gg.looseOff;
      const rim = game.attackFloor(side);
      let no = 0, nd = 0;
      for (const p of game.players) {
        if (p.team === side) lagOff.push(p.looseReactT); else lagDef.push(p.looseReactT);
        if (dist2DTo(p.pos, rim.x, rim.z) < 4) { if (p.team === side) no++; else nd++; }
      }
      nearOff.push(no); nearDef.push(nd);
    }
    game.update(DT);
    if (wasReb && game.ballMode !== "loose") {
      const h = game.handler;
      if (!h) none++; else if (h.team === side) off++; else def++;
    }
    wasReb = reb;
  }
}
void dist2D;
const avg = (a: number[]): string => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : "-";
const tot = off + def;
console.log(`リバウンド ${off + def + none} 場面（${NG} 試合）`);
console.log(`\n反応の遅れ（ルーズ開始時に入る値。小さいほど早く動き出す）`);
console.log(`  攻撃側 平均 ${avg(lagOff)}秒（${lagOff.length} 人ぶん）`);
console.log(`  守備側 平均 ${avg(lagDef)}秒（${lagDef.length} 人ぶん）`);
console.log(`\nシュートが外れた瞬間、リム 4m 以内に居た人数`);
console.log(`  攻撃側 平均 ${avg(nearOff)} 人 / 守備側 平均 ${avg(nearDef)} 人`);
console.log(`\n確保したのはどちらか`);
console.log(`  攻撃側(オフェンスリバウンド) ${off} 回  ${(off / Math.max(1, tot) * 100).toFixed(0)}%`);
console.log(`  守備側(ディフェンスリバウンド) ${def} 回  ${(def / Math.max(1, tot) * 100).toFixed(0)}%`);
console.log(`  どちらでもなく終了 ${none} 回`);
console.log(`\n※ 実際のバスケットボールではオフェンスリバウンドは 22〜28% 程度。`);
