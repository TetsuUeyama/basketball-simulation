// 回帰テスト: 試合中にロスターを入れ替えても、得点・クォーター・ラインスコアが壊れないこと。
// ⚠️ かつて swapRosterSlots が onPrepare()（＝game.reset()）を呼んでおり、
//    クォーター間の入れ替えで 1Q の得点が 0 に戻っていた。
import "./stubs";
let _s = 0x9e3779b9 >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam, ROSTER } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
clubTeam(0, 0); clubTeam(1, 4);
g.applyRoster(); g.reset();
const DT = 1 / 60;
for (let i = 0; i < 60 * 60 * 6; i++) game.update(DT);
const before = { score: [...game.score], q: game.quarter, line: game.qLine.map((a) => [...a]) };
console.log("入れ替え前:", JSON.stringify(before));

// swapRosterSlots が行う「ロスターの入れ替え + applyRoster」だけを再現する。
const r = ROSTER[1];
[r[0], r[7]] = [r[7], r[0]];
g.applyRoster();

const after = { score: [...game.score], q: game.quarter, line: game.qLine.map((a) => [...a]) };
console.log("入れ替え後:", JSON.stringify(after));
const ok = before.score[0] === after.score[0] && before.score[1] === after.score[1]
  && before.q === after.q
  && JSON.stringify(before.line) === JSON.stringify(after.line);
console.log(ok ? "OK: 得点・クォーター・ラインスコアは保たれた"
               : "NG: 試合状態が壊れた");
// 念のため、入れ替えた選手がコート上に反映されているか
console.log("コート上の team1 slot0:", game.teamPlayers(1)[0].name, "/ ROSTER[1][0]:", ROSTER[1][0].name);
