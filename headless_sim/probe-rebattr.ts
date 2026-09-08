// ボックスアウトの不利を、身長やボディバランスで覆せるか。
// リバウンドの場面ごとに「リム4m以内に居た選手」を競り参加とみなし、
// その選手が確保した割合を能力値の帯ごとに出す。
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { dist2DTo } from "../src/util";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 24);
type G2 = Game & { looseIsRebound: boolean; looseOff: number };

type Cell = { n: number; win: number };
const mk = (): Cell => ({ n: 0, win: 0 });
// 攻撃側の競り参加者を、身長帯 / バランス帯 でまとめる
const byH: Record<string, Cell> = { "〜1.85": mk(), "1.85〜1.95": mk(), "1.95〜": mk() };
const byB: Record<string, Cell> = { "〜60": mk(), "60〜80": mk(), "80〜": mk() };
const elite = mk();     // 身長 1.95以上 かつ バランス 85以上 の攻撃側
const weak = mk();      // 身長 1.85未満 かつ バランス 60未満 の攻撃側
const defAll = mk();    // 参考: 守備側の競り参加者
let scenes = 0;

for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  let wasReb = false, side = 0;
  let contenders: Player[] = [];
  for (let i = 0; i < 60 * 60 * 4; i++) {
    const gg = game as G2;
    const reb = game.ballMode === "loose" && gg.looseIsRebound;
    if (reb && !wasReb) {
      side = gg.looseOff;
      const rim = game.attackFloor(side);
      contenders = game.players.filter((p) => dist2DTo(p.pos, rim.x, rim.z) < 4);
    }
    game.update(DT);
    if (wasReb && game.ballMode !== "loose") {
      scenes++;
      const h = game.handler;
      for (const p of contenders) {
        const won = h === p;
        if (p.team !== side) { defAll.n++; if (won) defAll.win++; continue; }
        const hb = p.height < 1.85 ? "〜1.85" : p.height < 1.95 ? "1.85〜1.95" : "1.95〜";
        const bb = p.attr.balance < 60 ? "〜60" : p.attr.balance < 80 ? "60〜80" : "80〜";
        byH[hb].n++; byB[bb].n++;
        if (won) { byH[hb].win++; byB[bb].win++; }
        if (p.height >= 1.95 && p.attr.balance >= 85) { elite.n++; if (won) elite.win++; }
        if (p.height < 1.85 && p.attr.balance < 60) { weak.n++; if (won) weak.win++; }
      }
      contenders = [];
    }
    wasReb = reb;
  }
}
const pc = (c: Cell): string => c.n ? `${(c.win / c.n * 100).toFixed(0)}%（${c.win}/${c.n}）` : "標本なし";
console.log(`リバウンド ${scenes} 場面（${NG} 試合）`);
console.log(`\n「リム4m以内に居た攻撃側の選手」が、その場面で確保した割合`);
console.log(`  身長別`);
for (const k of Object.keys(byH)) console.log(`    ${k.padEnd(12, "　")} ${pc(byH[k])}`);
console.log(`  ボディバランス別`);
for (const k of Object.keys(byB)) console.log(`    ${k.padEnd(12, "　")} ${pc(byB[k])}`);
console.log(`\n  身長1.95以上 かつ バランス85以上 ${pc(elite)}`);
console.log(`  身長1.85未満 かつ バランス60未満 ${pc(weak)}`);
console.log(`\n参考: 守備側の競り参加者 ${pc(defAll)}`);
