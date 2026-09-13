// オフボールのポジション争いを測る。
//   ・マーク外し(tryShake)が何回試され、何回成功しているか（パワー / クイック）
//   ・パスコースを潰された(fronted)状態が、どれくらいで解消されているか
//   ・オフボール同士の接触がどれくらい起きているか
import "./stubs";
let _s = 0x9e3779b9;
Math.random = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 4294967296); };
import { NullEngine, Scene } from "@babylonjs/core";
import { Game } from "../src/game";
import { Player } from "../src/objects/player/player";
import { buildCourt } from "../src/objects/court";
import { BODY_MIN_DIST } from "../src/config";
import { rate } from "../src/util";
import { laneBlock } from "../src/move/reaction/pass-risk";
import { MOVE_LOG, MOVE_TRACE } from "../src/util";
Player.HEADLESS = true;
import { clubTeam } from "../src/roster";
const scene = new Scene(new NullEngine());
const hoops = buildCourt(scene); const game = new Game(scene);
(game as unknown as { attachHoops(h: unknown): void }).attachHoops(hoops);
const g = game as unknown as { applyRoster(): void; reset(): void };
const DT = 1 / 60;
const NG = Number(process.env.NG ?? 4);

let tries = 0, okPower = 0, okQuick = 0;
let frontedRuns = 0; const frontedLen: number[] = [];
let contactF = 0, contactBig = 0;
const diffs: number[] = [];
let shoves = 0, curved = 0, straight = 0;
let shoveOff = 0, shoveDef = 0;
const shoveMode: Record<string, number> = {};
const stuns: number[] = [];
const prevShoved = new Map<Player, number>();
const prevFoul = new Map<Player, number>();
let staggers = 0;
const pending: { p: Player; d: Player; gap0: number; at: number; power: boolean }[] = [];
const gained: number[] = [], gainedPower: number[] = [];
const spdQuickO: number[] = [], spdQuickD: number[] = [];
const spdPowO: number[] = [], spdPowD: number[] = [];
const capRatio: number[] = [];
const lagm: number[] = [];
let openAll = 0, openFar = 0, openFree = 0;
let nearAll = 0, nearMid = 0, nearStill = 0, markAll = 0, markTouch = 0, markClose = 0;
const nearWhy: Record<string, number> = {};
const nearSite: Record<string, number> = {};
const turnF: number[] = [], leanF: number[] = [];
let nPlant = 0, nCool = 0, nLand = 0, nShoved = 0, nAll = 0;   // オフボール同士が体を寄せているフレーム
const prevShakeT = new Map<Player, number>();
const prevOpen = new Map<Player, number>();
const frontStart = new Map<Player, number>();
let frames = 0;

MOVE_TRACE.on = false;   // 呼び出し元の記録は重い。原因が分かったら切る
for (let gi = 0; gi < NG; gi++) {
  clubTeam(0, gi % 8); clubTeam(1, (gi + 4) % 8);
  g.applyRoster(); g.reset();
  prevShakeT.clear(); prevOpen.clear(); frontStart.clear(); prevShoved.clear();
  for (let i = 0; i < 60 * 60 * 4; i++) {
    for (const a of MOVE_LOG.values()) a.length = 0;
    game.update(DT);
    frames++;
    const t = frames * DT;
    for (const p of game.players) {
      const ps = prevShakeT.get(p) ?? 0, po = prevOpen.get(p) ?? 0;
      if (p.shakeT > ps + 0.5) tries++;                       // 試行（クールダウンが立った）
      if (p.shakeOpenT > po + 0.3) {
        if (p.shakePower) okPower++; else okQuick++;
        if (Math.abs(p.shakeCurve) > 0.01) curved++; else straight++;
        // ⚠️ 「外した」と言えるのは距離が開いたとき。発動した瞬間と 0.5秒後を比べる。
        const dd = game.teamPlayers(1 - p.team)[p.slot];
        if (dd) pending.push({ p, d: dd, gap0: Math.hypot(dd.pos.x - p.pos.x, dd.pos.z - p.pos.z),
          at: frames + 60, power: p.shakePower });   // 1.0秒後（外しの長さに合わせる）
      }
      const pf = prevFoul.get(p) ?? 0;
      if (p.foulReactT > pf + 0.05) staggers++;
      prevFoul.set(p, p.foulReactT);
      const pv = prevShoved.get(p) ?? 0;
      if (p.shovedT > pv + 0.02 && p !== game.handler) {
        shoves++; stuns.push(p.shovedT);
        // ⚠️ スタンが片側だけに偏っていないか。両側に同じだけ起きるなら、
        //    得点の増減をスタンのせいにはできない。
        if (p.team === game.possession) shoveOff++; else shoveDef++;
        // ⚠️ 押し合いは「ボール保持中」だけでなく、リバウンド争い・シュート前にも
        //    同じ式で起きているか（同じ接触モデルを使っているかの確認）。
        const m = game.looseIsRebound && game.ballMode === "loose" ? "リバウンド"
          : game.ballMode === "shot" || game.ballMode === "charge" ? "シュート前" : game.ballMode;
        shoveMode[m] = (shoveMode[m] ?? 0) + 1;
      }
      prevShoved.set(p, p.shovedT);
      prevShakeT.set(p, p.shakeT); prevOpen.set(p, p.shakeOpenT);
      // パスコースを潰されている状態の長さ
      if (p.frontedT > 0) {
        if (!frontStart.has(p)) { frontStart.set(p, t); frontedRuns++; }
      } else if (frontStart.has(p)) {
        frontedLen.push(t - frontStart.get(p)!);
        frontStart.delete(p);
      }
    }
    // 外している最中の「実際の速さ」を攻守で比べる
    for (const q of game.players) {
      if (q.shakeOpenT <= 0) continue;
      const dq = game.teamPlayers(1 - q.team)[q.slot];
      if (!dq) continue;
      if (dq.trackOn) lagm.push(Math.hypot(q.pos.x - dq.trackX, q.pos.z - dq.trackZ));
      (q.shakePower ? spdPowO : spdQuickO).push(q.curSpd);
      (q.shakePower ? spdPowD : spdQuickD).push(dq.curSpd);
      if (!q.shakePower) {
        capRatio.push(q.runSpeed > 0 ? q.curSpd / q.runSpeed : 0);
        // ⚠️ 何が足を止めているのかを要因ごとに見る。推測で直さない。
        const tx = q.pos.x + q.shakeDirX * 2.0, tz = q.pos.z + q.shakeDirZ * 2.0;
        turnF.push(q.turnFactor(tx, tz));
        leanF.push(q.leanFactor(tx, tz));
        if (q.plantT > 0) nPlant++;
        if (q.coolT > 0) nCool++;
        if (q.landT > 0) nLand++;
        if (q.shovedT > 0) nShoved++;
        nAll++;
      }
    }
    // 0.5秒後の距離を回収
    for (let k = pending.length - 1; k >= 0; k--) {
      if (pending[k].at > frames) continue;
      const e = pending.splice(k, 1)[0];
      const g2 = Math.hypot(e.d.pos.x - e.p.pos.x, e.d.pos.z - e.p.pos.z);
      (e.power ? gainedPower : gained).push(g2 - e.gap0);
    }
    // フロントコート確立後に、まだセンターライン付近に居る攻撃側は誰か
    if (game.ballMode === "held" && game.frontT) {
      const sg = game.attackSign(game.possession);
      for (const q of game.teamPlayers(game.possession)) {
        nearAll++;
        if (q.pos.z * sg > 3.0) continue;      // 自陣寄り〜センター付近だけ見る
        nearMid++;
        // ⚠️ 走って通過しているだけか、そこで**止まっている**のかを分ける。
        if (Math.hypot(q.velX, q.velZ) > 0.5) continue;
        nearStill++;
        const why = q === game.handler ? "ハンドラー" : q.cutting ? "カット" : q.screening ? "スクリーン"
          : q.shakeOpenT > 0 ? "マーク外し" : q.frontRunT > 0 ? "frontRun"
          : q.transitT > 0 ? "守備へ戻り" : "スポット" + q.spotIdx;
        nearWhy[why] = (nearWhy[why] ?? 0) + 1;
        // ⚠️ どのコードが（あるいは何も）動かしていないのかを見る。分類名は当てにしない。
        const lg = MOVE_LOG.get(q.pos) ?? [];
        const site = lg.length ? lg[lg.length - 1].site : "(命令なし)";
        nearSite[site] = (nearSite[site] ?? 0) + 1;
      }
    }
    // マークしている守備との距離（オフボールのみ）と接触
    if (game.ballMode === "held" && game.handler && game.frontT) {
      for (const q of game.teamPlayers(game.possession)) {
        if (q === game.handler) continue;
        const dq = game.teamPlayers(1 - q.team)[q.slot];
        if (!dq) continue;
        const gg = Math.hypot(dq.pos.x - q.pos.x, dq.pos.z - q.pos.z);
        markAll++;
        // ⚠️ 分離解決(BODY_MIN_DIST=0.62m)が押し離すので、それ未満にはならない。
        //    「体が当たっている」は 0.62〜0.85m の帯で見る。
        if (gg < 0.85) markTouch++;
        else if (gg < 1.3) markClose++;
      }
    }
    // 「フリーで受けられる状態」の割合: 担当守備から離れ、かつパスコースが通っている
    if (game.ballMode === "held" && game.handler) {
      for (const q of game.teamPlayers(game.possession)) {
        if (q === game.handler) continue;
        const dq = game.teamPlayers(1 - q.team)[q.slot];
        const gap = dq ? Math.hypot(dq.pos.x - q.pos.x, dq.pos.z - q.pos.z) : 9;
        openAll++;
        if (gap > 2.5) openFar++;
        if (gap > 2.5 && !laneBlock(game.teamPlayers(1 - q.team), game.handler, q)) openFree++;
      }
    }
    // オフボール同士（ボール保持者・その担当以外）の体の接触
    if (game.ballMode === "held" && game.handler) {
      const off = game.teamPlayers(game.possession), def = game.teamPlayers(1 - game.possession);
      for (const a of off) {
        if (a === game.handler) continue;
        for (const b of def) {
          const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
          if (d > BODY_MIN_DIST + 0.05) continue;
          contactF++;
          const df = Math.abs(rate(a.attr.balance) - rate(b.attr.balance));
          diffs.push(df);
          if (df > 0.2) contactBig++;
        }
      }
    }
  }
}
const med = (a: number[]): string => a.length
  ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(2) : "-";
console.log(NG + "試合 / " + frames + "フレーム");
console.log("マーク外しの試行 " + tries + "回（" + (tries / NG).toFixed(1) + "回/試合）"
  + " / 成功 パワー " + okPower + " + クイック " + okQuick
  + " = " + (((okPower + okQuick) / Math.max(1, tries)) * 100).toFixed(0) + "%");
console.log("パスコースを潰された回数 " + frontedRuns + "（" + (frontedRuns / NG).toFixed(1) + "回/試合）"
  + " / 続いた時間 中央 " + med(frontedLen) + "秒");
console.log("押し出された回数（オフボールの体負け）: " + shoves + "（" + (shoves / NG).toFixed(1)
  + "回/試合） / 動けない時間 中央 " + med(stuns) + "秒");
console.log("フロントコート確立後、センター付近(自陣〜+3m)に居る攻撃側: "
  + (nearMid / Math.max(1, nearAll) * 100).toFixed(1) + "%（うち**止まっている** "
  + (nearStill / Math.max(1, nearAll) * 100).toFixed(1) + "%）  止まっている内訳: "
  + Object.entries(nearWhy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => k + " " + n).join(" / "));
console.log("  止まっている選手を動かしている場所: " + Object.entries(nearSite)
  .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + " " + n).join(" / "));
console.log("マークの間合い: 体が当たっている(0.85m未満) "
  + (markTouch / Math.max(1, markAll) * 100).toFixed(1) + "% / 1.3m未満 "
  + (markClose / Math.max(1, markAll) * 100).toFixed(1) + "%");
console.log("オフボール攻撃がフリーな割合: 守備から2.5m超 "
  + (openFar / Math.max(1, openAll) * 100).toFixed(1) + "%"
  + " / さらにパスコースも通っている " + (openFree / Math.max(1, openAll) * 100).toFixed(1) + "%");
console.log("外した1.0秒後の距離の変化: クイック 中央 " + med(gained) + "m（" + gained.length + "件）"
  + " / パワー 中央 " + med(gainedPower) + "m（" + gainedPower.length + "件）"
  + " / 1m以上離せた割合 "
  + ([...gained, ...gainedPower].filter((v) => v >= 1).length
    / Math.max(1, gained.length + gainedPower.length) * 100).toFixed(0) + "%");
console.log("外している最中の速さ 中央: クイック 攻 " + med(spdQuickO) + " vs 守 " + med(spdQuickD)
  + " m/s / パワー 攻 " + med(spdPowO) + " vs 守 " + med(spdPowD) + " m/s");
console.log("  クイックの攻撃が出せている割合（走る速さに対して）: " + med(capRatio));
console.log("  守備の見え位置の遅れ: 中央 " + med(lagm) + "m / 90% "
  + (lagm.length ? [...lagm].sort((a, b) => a - b)[Math.floor(lagm.length * 0.9)].toFixed(2) : "-") + "m");
console.log("  足を止めている要因: 向き変え " + med(turnF) + " / 体の傾き " + med(leanF)
  + " / プラント中 " + (nPlant / Math.max(1, nAll) * 100).toFixed(0) + "%"
  + " / クール " + (nCool / Math.max(1, nAll) * 100).toFixed(0) + "%"
  + " / 着地 " + (nLand / Math.max(1, nAll) * 100).toFixed(0) + "%"
  + " / 押され " + (nShoved / Math.max(1, nAll) * 100).toFixed(0) + "%");
console.log("  押し合いが起きている場面: " + Object.entries(shoveMode)
  .sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " " + n).join(" / "));
console.log("  体勢が崩れた(よろめき)回数: " + staggers + "（" + (staggers / NG).toFixed(1) + "回/試合）");
console.log("  スタンの偏り: 攻撃側が食らった " + shoveOff + " / 守備側 " + shoveDef
  + "（攻撃 " + (shoveOff / Math.max(1, shoveOff + shoveDef) * 100).toFixed(0) + "%）");
console.log("曲がって外した回数: " + curved + " / まっすぐ " + straight);
console.log("接触時のバランス差: 中央 " + med(diffs) + " / 90% "
  + (diffs.length ? [...diffs].sort((x, y) => x - y)[Math.floor(diffs.length * 0.9)].toFixed(2) : "-")
  + " / 最大 " + (diffs.length ? Math.max(...diffs).toFixed(2) : "-"));
console.log("オフボール同士が体を寄せているフレーム " + contactF
  + "（うちバランス差0.2超 " + (contactBig / Math.max(1, contactF) * 100).toFixed(0) + "%）");
