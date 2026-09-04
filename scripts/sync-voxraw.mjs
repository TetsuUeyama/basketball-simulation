// voxel-pipeline の出力を確認ページ用に public/vox/<name>/ へ複製する。
//   node scripts/sync-voxraw.mjs [name]
// ⚠️ .vox / *.grid.json / grid.json / manifest.json / skeleton.json / *.weights.json の
//    **全部**が要る。weights を落とすと骨に貼れず、確認ページが真っ黒になる（実際にやった）。
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const name = process.argv[2] ?? "player_one";
const src = `C:/Users/user/developsecond/game-assets/vox-model/${name}`;
const dst = fileURLToPath(new URL(`../public/vox/${name}`, import.meta.url));
if (!existsSync(src)) { console.error(`出力が無い: ${src}`); process.exit(1); }

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
const KEEP = (f) => f.endsWith(".vox") || f.endsWith(".grid.json") || f.endsWith(".weights.json")
  || f === "grid.json" || f === "manifest.json" || f === "skeleton.json";
let n = 0, bytes = 0;
for (const f of readdirSync(src)) {
  if (!KEEP(f)) continue;
  cpSync(join(src, f), join(dst, f));
  n++;
}
console.log(`public/vox/${name} へ ${n} ファイルを複製`);
