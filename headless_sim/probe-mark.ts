// markSlot / defMode が守備 AI に効いているかの確認。
// team1 の守備を「全員シフト（slot i は相手 (i+1)%5 を見る）」+ 1人ゾーンにして、
// 指示どおりの相手に近づいているかを測る。
import "./stubs";
let _s = 0x9e3779b9 >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
Player.HEADLESS = true;
import { clubTeam, ROSTER } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 3);
const SHIFT = Number(process.env.SHIFT ?? 1);
let nAssigned = 0, dAssigned = 0, nDefault = 0, dDefault = 0;
let zoneN = 0, zoneRim = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  // 指示を入れる: team1 の slot i は相手 (i+SHIFT)%5 を見る。slot 4 はゾーン。
  for (let i = 0; i < 5; i++) {
    ROSTER[1][i].defMode = i === 4 ? "zone" : "man";
    ROSTER[1][i].markSlot = i === 4 ? undefined : (i + SHIFT) % 5;
  }
  g.applyRoster(); g.reset();
  if (gi === 0) console.log("  [診断] コート上の markSlot:", game.teamPlayers(1).map((p) => p.markSlot), "defMode:", game.teamPlayers(1).map((p) => p.defMode));
  for (let i = 0; i < 60 * 60 * 6; i++) {
    game.update(DT);
    if (i % 30 || game.possession !== 0 || !game.frontT) continue;
    const off = game.teamPlayers(0), def = game.teamPlayers(1);
    for (let k = 0; k < 5; k++) {
      const d = def[k];
      if (k === 4) {
        zoneN++; zoneRim += dist2D(d.pos, game.attackFloor(1));   // 守るリムからの距離
        continue;
      }
      const want = off[(k + SHIFT) % 5], plain = off[k];
      if (!want || !plain) continue;
      // ⚠️ 位置そのものは陣形の幾何に支配されるので指標にならない。
      //    注目システムが持つ「見えている担当の位置」(trackX/trackZ) が誰を指しているかで測る。
      const tx = d.trackX, tz = d.trackZ;
      nAssigned++; dAssigned += Math.hypot(tx - want.pos.x, tz - want.pos.z);
      nDefault++; dDefault += Math.hypot(tx - plain.pos.x, tz - plain.pos.z);
    }
  }
}
const av = (s: number, n: number) => (s / Math.max(1, n)).toFixed(2);
console.log(`${NG}試合  指示 = 「slot i は相手 (i+${SHIFT})%5 を見る」/ slot4 はゾーン`);
console.log(`  追跡位置と「指示した相手」のズレ: ${av(dAssigned, nAssigned)}m  (${nAssigned}件)`);
console.log(`  追跡位置と「同じ番号の相手」のズレ: ${av(dDefault, nDefault)}m  ← 指示が効いていれば こちらが遠い`);
console.log(`  ゾーン指定の選手が守るリムから: ${av(zoneRim, zoneN)}m  (${zoneN}件)`);
