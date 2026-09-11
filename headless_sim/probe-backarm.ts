// 逆手の形を決めるための掃引。上腕の振り角と肘の曲げで、手首が体の前後どちらに来るか。
// ⚠️ numberSide 両方。符号は推測せずここで決める。
import "./stubs";
import { NullEngine, Scene, Quaternion, Vector3 } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
Player.HEADLESS = true;
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
g.applyRoster(); g.reset();
const X = new Vector3(1, 0, 0);
for (const ns of [1, -1]) {
  const p = game.players[ns > 0 ? 0 : 1];
  p.setNumberSide(ns);
  p.pos.set(0, 0, 0);
  p.root.rotation.y = 0;
  p.lastDt = 1;   // 1秒ぶん = イーズを一気に収束させる
  const fx = Math.sin(0) * -ns, fz = Math.cos(0) * -ns;   // 胸の向き
  console.log(`numberSide=${ns > 0 ? "+1" : "-1"}  （前がプラス）`);
  for (const bend of [0.4, 1.0, 1.4]) {
    const out: string[] = [];
    for (let ang = -0.8; ang <= 1.41; ang += 0.4) {
      for (let k = 0; k < 8; k++) {   // イーズを収束させる
        p.easeArm(p.armPivotR, Quaternion.RotationAxis(X, ang * ns));
        p.bendElbow(p.elbowR, bend);
      }
      p.sync();
      p.wristR.computeWorldMatrix(true);
      const w = p.wristR.getAbsolutePosition();
      const fwd = (w.x - p.pos.x) * fx + (w.z - p.pos.z) * fz;
      out.push(`${ang.toFixed(1)}:${fwd >= 0 ? "+" : ""}${fwd.toFixed(2)}/${w.y.toFixed(2)}`);
    }
    console.log(`  肘 ${bend.toFixed(1)}rad  ` + out.join("  "));
  }
}
console.log("※ 表記 振り角:前後/高さ。前後が負 = 手首が体より後ろ");
