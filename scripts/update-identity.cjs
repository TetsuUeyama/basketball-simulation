// WE2010 の Excel から identity.ts の role / hand / weightKg / posMask を更新する。
//
//   node scripts/update-identity.cjs          … 差分を表示するだけ（書き換えない）
//   WRITE=1 node scripts/update-identity.cjs  … identity.ts を書き換える
//
// 出典: `OneDrive/デスクトップ/WE2010 0903.xlsx` Sheet1（ヘッダ2行目・データ3行目〜）。
//   D=選手名 / J=C K=PF L=SF M=SG N=PG（守れるポジションのフラグ）/ O=身長 / P=体重 / R=利き足
// ⚠️ 旧ブックとは列配置が違う（旧は CI..DE が能力値）。列を変えたらここを直す。
// ⚠️ Excel の行の並びは identity.ts と一致しない。**名前で照合**し、同名（42組）は
//    「名前＋身長」で識別する。python は Store スタブで動かないので node+xlsx を使う。
//    xlsx は本体の依存に入れていないので、スクラッチパッド等で `npm i xlsx` してから実行する。
const fs = require("fs");
const path = require("path");

const XLS = process.env.XLS ?? "C:/Users/user/OneDrive/デスクトップ/WE2010 0903.xlsx";
const ID_TS = path.join(__dirname, "..", "src", "data", "player-data", "identity.ts");

let XLSX;
try { XLSX = require("xlsx"); }
catch { console.error("xlsx が無い。`npm i xlsx` した場所から NODE_PATH を通して実行する。"); process.exit(1); }

const ORDER = ["C", "PF", "SF", "SG", "PG"];
const POS_COL = { C: "J", PF: "K", SF: "L", SG: "M", PG: "N" };
const BIT = { C: 1, PF: 2, SF: 4, SG: 8, PG: 16 };

const wb = XLSX.readFile(XLS);
const ws = wb.Sheets["Sheet1"];
const R = XLSX.utils.decode_range(ws["!ref"]);
const cell = (r, col) => { const c = ws[col + (r + 1)]; return c === undefined ? null : c.v; };

const ex = [];
for (let r = 2; r <= R.e.r; r++) {
  const name = cell(r, "D");
  if (name === null || String(name).trim() === "") continue;
  ex.push({
    name: String(name).trim(),
    pos: ORDER.filter((p) => { const v = cell(r, POS_COL[p]); return v !== null && String(v).trim() !== ""; }),
    h: cell(r, "O"), w: cell(r, "P"),
    hand: String(cell(r, "R")).trim() === "左" ? "L" : "R",
    used: false,
  });
}
const byName = new Map();
for (const e of ex) { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e); }

// 現行 identity.ts。旧形式(6要素)・新形式(8要素)のどちらも受ける（再実行できるように）。
const src = fs.readFileSync(ID_TS, "utf8");
const ROW = /^(\s*)\[(\d+),"([^"]*)","([^"]*)",(\d+),"([^"]*)",(\[[\d,]+\])(?:,(-?\d+),(-?\d+))?\](,?)$/;

/** 守れるポジションから主ポジションを決める（C..PG 順の中央値）。 */
const primary = (pos) => pos[Math.floor((pos.length - 1) / 2)];

let updated = 0, unmatched = [], ambiguous = 0;
const changed = { role: 0, hand: 0, weight: 0, mask: 0 };
const roleDist = {}, handDist = {};

const out = src.split(/\r?\n/).map((line) => {
  const m = ROW.exec(line);
  if (!m) return line;
  const [, indent, id, name, oldRole, h, oldHand, look, oldW, oldMask, comma] = m;
  const cands = byName.get(name) ?? [];
  let e = cands.find((c) => !c.used && c.h === Number(h));
  if (!e) { e = cands.find((c) => !c.used); if (e && cands.length > 1) ambiguous++; }
  if (!e) { unmatched.push(name); return line; }
  e.used = true;

  const role = primary(e.pos);
  const mask = e.pos.reduce((a, p) => a | BIT[p], 0);
  updated++;
  if (role !== oldRole) changed.role++;
  if (e.hand !== oldHand) changed.hand++;
  if (oldW !== undefined && Number(oldW) !== e.w) changed.weight++;
  if (oldMask !== undefined && Number(oldMask) !== mask) changed.mask++;
  roleDist[role] = (roleDist[role] ?? 0) + 1;
  handDist[e.hand] = (handDist[e.hand] ?? 0) + 1;
  return `${indent}[${id},"${name}","${role}",${h},"${e.hand}",${look},${e.w},${mask}]${comma}`;
});

let text = out.join("\n");
// ヘッダと型を新形式へ（既に新形式なら何も起きない）
text = text.replace(
  '// [id, name, role(PG/SG/SF/PF/C), heightCm, hand("R"|"L"), look[skin,hair,style,hairNo]]。',
  '// [id, name, role(PG/SG/SF/PF/C), heightCm, hand("R"|"L"), look[skin,hair,style,hairNo], weightKg, posMask]。\n'
  + '// role は「守れるポジション」の中央値（C..PG 順）。posMask は守れるポジションのビット和\n'
  + '// （C=1 / PF=2 / SF=4 / SG=8 / PG=16）。どちらも WE2010 0903.xlsx の J〜N 列が出典。');
text = text.replace(
  'export type IdentityRow = [number, string, string, number, string, [number, number, number, number]];',
  'export type IdentityRow =\n  [number, string, string, number, string, [number, number, number, number], number, number];');

if (process.env.WRITE === "1") { fs.writeFileSync(ID_TS, text); console.log("→ identity.ts を書き換えた"); }
console.log(`照合 ${updated}人 / 未一致 ${unmatched.length}人 / 同名で身長も一致せず ${ambiguous}人`);
if (unmatched.length) console.log("  未一致:", unmatched.slice(0, 10).join(" / "));
console.log(`変更: role ${changed.role} / 利き手 ${changed.hand} / 体重 ${changed.weight} / posMask ${changed.mask}`);
console.log("role 分布:", ORDER.map((k) => `${k}:${roleDist[k] ?? 0}`).join(" "));
console.log("利き手 分布:", Object.entries(handDist).map(([k, v]) => `${k}:${v}`).join(" "));
