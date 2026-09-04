// WE2010 0903.xlsx（バスケのポジション C〜PG と体重を追加した版）から
// identity.ts の role を更新し、weightKg と posMask を追記する。
//   posMask のビット: C=1 / PF=2 / SF=4 / SG=8 / PG=16
const XLSX = require("xlsx"), fs = require("fs");
const XLS = "C:/Users/user/OneDrive/デスクトップ/WE2010 0903.xlsx";
const ID_TS = "C:/Users/user/developsecond/basketball-simulation/src/data/player-data/identity.ts";

const ORDER = ["C", "PF", "SF", "SG", "PG"];
const POS_COL = { C: "J", PF: "K", SF: "L", SG: "M", PG: "N" };
const BIT = { C: 1, PF: 2, SF: 4, SG: 8, PG: 16 };

const wb = XLSX.readFile(XLS);
const ws = wb.Sheets["Sheet1"];
const R = XLSX.utils.decode_range(ws["!ref"]);
const cell = (r, col) => { const c = ws[col + (r + 1)]; return c === undefined ? null : c.v; };

const ex = [];
for (let r = 2; r <= R.e.r; r++) {
  const name = cell(r, "D"); if (name === null || String(name).trim() === "") continue;
  const pos = ORDER.filter((p) => { const v = cell(r, POS_COL[p]); return v !== null && String(v).trim() !== ""; });
  ex.push({ name: String(name).trim(), pos, h: cell(r, "O"), w: cell(r, "P"), used: false });
}
// 名前 → 候補行
const byName = new Map();
for (const e of ex) { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e); }

const src = fs.readFileSync(ID_TS, "utf8");
const ROW = /^(\s*)\[(\d+),"([^"]*)","([^"]*)",(\d+),"([^"]*)",(\[[\d,]+\])\](,?)$/;
const lines = src.split(/\r?\n/);

/** 位置フラグから主ポジションを決める（C..PG 順の中央値）。 */
const primary = (pos) => pos[Math.floor((pos.length - 1) / 2)];

let updated = 0, roleChanged = 0, unmatched = [], ambiguous = 0;
const roleDist = {}, posCount = {};
const out = lines.map((line) => {
  const m = ROW.exec(line);
  if (!m) return line;
  const [, indent, id, name, oldRole, h, hand, look, comma] = m;
  const cands = byName.get(name) ?? [];
  // 同名は身長一致を優先し、無ければ未使用の先頭を取る
  let e = cands.find((c) => !c.used && c.h === Number(h));
  if (!e) { e = cands.find((c) => !c.used); if (e && cands.length > 1) ambiguous++; }
  if (!e) { unmatched.push(name); return line; }
  e.used = true;
  const role = primary(e.pos);
  const mask = e.pos.reduce((a, p) => a | BIT[p], 0);
  updated++;
  if (role !== oldRole) roleChanged++;
  roleDist[role] = (roleDist[role] ?? 0) + 1;
  posCount[e.pos.length] = (posCount[e.pos.length] ?? 0) + 1;
  return `${indent}[${id},"${name}","${role}",${h},"${hand}",${look},${e.w},${mask}]${comma}`;
});

// 型定義とヘッダのコメントを更新
let text = out.join("\n");
text = text.replace(
  '// [id, name, role(PG/SG/SF/PF/C), heightCm, hand("R"|"L"), look[skin,hair,style,hairNo]]。',
  '// [id, name, role(PG/SG/SF/PF/C), heightCm, hand("R"|"L"), look[skin,hair,style,hairNo], weightKg, posMask]。\n'
  + '// role は「守れるポジション」の中央値（C..PG 順）。posMask は守れるポジションのビット和\n'
  + '// （C=1 / PF=2 / SF=4 / SG=8 / PG=16）。どちらも WE2010 0903.xlsx の J〜N 列が出典。');
text = text.replace(
  'export type IdentityRow = [number, string, string, number, string, [number, number, number, number]];',
  'export type IdentityRow =\n  [number, string, string, number, string, [number, number, number, number], number, number];');

if (process.env.WRITE === "1") { fs.writeFileSync(ID_TS, text); console.log("→ identity.ts を書き換えた"); }
console.log(`更新 ${updated}人 / 未一致 ${unmatched.length}人 / 同名で身長も一致しなかった ${ambiguous}人`);
if (unmatched.length) console.log("  未一致:", unmatched.slice(0, 10).join(" / "));
console.log("role 分布:", ORDER.map((k) => `${k}:${roleDist[k] ?? 0}`).join(" "));
console.log("守れるポジション数の分布:", Object.entries(posCount).sort().map(([k, v]) => `${k}個:${v}人`).join(" "));
