// ゴール下のビッグ同士の攻防: 接触・押し合い・パスコース争いがどれだけ起きているか。
import "./stubs";
let _s = Number(process.env.SEED ?? 0x9e3779b9) >>> 0;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { dist2D } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 10);
let n = 0, contact = 0, shove = 0, deny = 0, shake = 0, seal = 0;
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  for (let i = 0; i < 60 * 60 * 8; i++) {
    game.update(DT);
    if (!game.frontT) continue;
    const t = game.possession, d = 1 - t;
    const post = game.postAnchor(t);
    if (!post || post === game.handler) continue;
    const rim = game.attackFloor(t);
    if (dist2D(post.pos, rim) > 5.0) continue;
    // 担当の守備者
    let nd = Infinity, who: Player | null = null;
    for (const q of game.teamPlayers(d)) {
      const gg = dist2D(q.pos, post.pos);
      if (gg < nd) { nd = gg; who = q; }
    }
    n++;
    if (nd < 0.85) contact++;                 // 体が当たっている間合い
    if (post.shovedT > 0 || (who && who.shovedT > 0)) shove++;
    if (who && who.denyT > 0) deny++;         // パスコースを消しに来ている
    if (post.shakeOpenT > 0) shake++;         // 攻撃側がマークを外しに動いている
    if (post.plantT > 0) seal++;              // 踏ん張ってシールしている
  }
}
const pc = (a: number, b: number) => (a / Math.max(1, b) * 100).toFixed(1) + "%";
console.log(`${NG}試合  ポストがゴール下に居るフレーム ${n}`);
console.log(`  体が当たっている(0.85m内): ${pc(contact, n)}`);
console.log(`  押されている(どちらか):     ${pc(shove, n)}`);
console.log(`  守備がパスコースを消しに来ている: ${pc(deny, n)}`);
console.log(`  攻撃がマークを外しに動いている:   ${pc(shake, n)}`);
console.log(`  攻撃が踏ん張ってシールしている:   ${pc(seal, n)}`);
