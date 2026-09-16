// リザルト画面のボックススコアが実際にどう表示されるかを文字で確認する（幅の検証用）。
import "./stubs";
let _s = 0x9e3779b9 >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
import { UI } from "../src/ui/ui";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
clubTeam(0, 0); clubTeam(1, 4);
g.applyRoster(); g.reset();
for (let i = 0; i < 60 * 60 * 20; i++) game.update(1 / 60);
const cols = UI.BOX_COLS;
const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - [...s].length));
console.log("列幅(px): 名前 " + UI.NAME_W + " / " + cols.map((c) => `${c.label}=${c.w}`).join(" "));
console.log("合計幅: " + (UI.NAME_W + cols.reduce((a, c) => a + c.w, 0) + cols.length * 2) + "px（余白2px）\n");
console.log(pad("PLAYER", 20) + cols.map((c) => pad(c.label, 10)).join(""));

for (const pl of game.allPlayers(0)) {
  const cells = cols.map((c) => c.get(pl.stats));

  console.log(pad(`${pl.role} ${pl.name}`.slice(0, 18), 20) + cells.map((t) => pad(t, 10)).join(""));
}
console.log("");
console.log("グループ見出し: " + cols.filter((c) => c.group).map((c) => c.label + "=" + c.group).join(" / "));
