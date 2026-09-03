# work-record

## 2026-09-03

- `C:\Users\user\developsecond\basketball-simulation` にプロジェクトを新規作成。
- 構成: Node + TypeScript（ヘッドレス）。Node の型ストリッピングで `.ts` を直接実行する。
- 追加ファイル: `package.json` / `tsconfig.json` / `.gitignore` / `README.md` / `workPlan.md` / `src/index.ts` / `src/rng.ts`
- リモート `https://github.com/TetsuUeyama/basketball-simulation.git` を origin に設定。
- 確認済み: `npm install` / `npm run typecheck` / `npm start` / `npm run build` が通ること。
- シミュレーション本体は未着手。次は workPlan の「未確定」を決めるところから。

---

## 2026-09-03（続き） basketball-sim を踏襲してゲーム化を開始

ユーザーの要望は4つ: ①クオーター毎のポーカーによる強化 ②1on1 の勝敗を能力で決める
③判定時の局所物理 ④スマホでの高速化とローディング表示。

### 決めたこと（ユーザー確認済み）

- **本体は basketball-simulation**（この新リポジトリ）。basketball-sim から移植して出発する。
- **描画は Babylon.js 3D を踏襲**（既存のボクセル選手・カメラ・HUD をそのまま使う）。
- **ユーザー操作はポーカーのみ**。試合そのものは従来どおり AI が進める（観戦）。
- ポーカーの核心ルール: **手札交換を打ち切って役を確定させるタイミングをホームチームが決める**。
  早く確定すれば効果が長く効き、引っ張れば強い役を狙えるが恩恵は短い。

### 1. 移植（commit 39a1ca1）

- basketball-sim の commit `76c9eca` から `src/`(約3万行) / `vendor/objcts` / `docs` /
  `scripts` / `headless_sim/*.ts` / `index.html` / `vite.config.ts` をコピー。
- ヘッドレス雛形の `package.json`・`tsconfig.json` を Vite + Babylon 構成へ差し替え
  （NodeNext + erasableSyntaxOnly → bundler + DOM lib）。`src/rng.ts` だけ雛形から残置。
- 確認: `npm install` / `npm run build` ✓。
- **実測: バンドル 11.98MB（gzip 2.71MB, 単一チャンク）**。要望4の出発点の数字。

### 2. ポーカー強化システム（機能1）

新規 `src/poker/`。Babylon にも DOM にも依存しない純粋ロジックにして、ヘッドレスで検証できる形にした。

| ファイル | 役割 |
| --- | --- |
| `cards.ts` | 札とデッキ。乱数は `src/rng.ts` のシード付き（再現性のため `Math.random` を使わない） |
| `hands.ts` | 役判定（`evalHand`）と役同士の比較 |
| `effects.ts` | **バランス調整ノブの集約**。カード→能力の対応、捨て札の量、役ごとのチーム強化 |
| `state.ts` | `PokerMatch` — 配札/交換/確定/巻き戻し。乗せた強化は全て記録して `revert()` できる |
| `ai.ts` | CPU の捨て札選択・強化先の選択・（ホームなら）確定タイミングの判断 |

- **カード→強化**: スートが系統（♥=オフェンス / ♦=ディフェンス / ♠=シュート / ♣=フィジカル）、
  ランクが量（A=主能力+5 / 絵札=系統内の特定能力+3 / 数札=主能力+2）。
  **同じカードでも選手によって効きが変わる**（その能力が高い選手ほど大きい、0.6〜1.4倍）。
- **捨て札は即座に個人強化**（確定を待たない）。1回の交換で捨てられるのは3枚まで（`MAX_DISCARDS`）。
- **役の確定でチーム全13人に強化**。tier(0..9) → 系統+0..6 / 全能力+0..4（`HAND_BUFF`）。
- 強化は `PlayerDef.attr` に直接足し、差分を `applied` に記録。試合リセット/BACK で `revert()`
  して素の能力値へ戻す（`Player.attr` は def へのライブ参照なので、これが唯一安全な戻し方）。

### 3. 試合本体への配線

- `Game` に `poker` / `pokerGate` / `onPokerRound` と `awaitPoker(round, next)` /
  `resumeFromPoker()` を追加。`core/gameflow.ts` のクォーター切り替え（引き上げ→ハドル→次Q）の
  間に `awaitPoker` を挟んだ。UI が居なければ素通りするので、ヘッドレスも従来どおり動く。
- `src/ui/ui-poker.ts` 新規: 手札の表示・捨てる札の選択・**捨て札ごとに強化先の選手を選ぶ**
  プルダウン（効果をその場で表示）・確定/持ち越しの選択・確定時の相手手札の公開。
- 試合前バーに「ポーカー: 自分で打つ ⇄ CPU同士」トグル（`POKER_OPTS.userTeam`）。
  CPU同士では画面を出さず自動で進む＝**CPU対CPUとCPU対ユーザーの両方が同じ処理で回る**。
- ポーカー画面が出ている間は `ui.simPaused` でシムだけ止める（描画とカメラは動かす）。

### 4. 検証

- `headless_sim/probe-poker.ts`: **52C5 の全 2,598,960 通りを列挙**して役の頻度を理論値と照合
  → 10種すべて完全一致（ロイヤル4 / SF36 / フォーカード624 / フルハウス3744 / フラッシュ5108 /
  ストレート10200 / スリーカード54912 / ツーペア123552 / ワンペア1098240 / ハイカード1302540）。
  境界（ホイールA2345 / K-A-2-3-4は非ストレート / ロイヤル）も期待どおり。
- CPU同士4000試合ぶんのポーカー: 確定ラウンドは R1:2.0% R2:18.8% R3:35.2% R4:44.0%、
  確定役はワンペア29.5% ツーペア29.0% スリーカード20.9%。1人あたりの平均上昇 0.84点/能力。
- `headless_sim/probe-poker-balance.ts`: 実際の試合を回して勝率への影響を測る
  （MODE=off / both / one / max）。**結果は下記**。

⚠️ ブラウザ実機（`npm run dev`）での見た目・操作感は未検証。
