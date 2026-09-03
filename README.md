# basketball-simulation

Babylon.js 製フルコート 5対5 のバスケットボールゲーム。
試合は AI が進める（観戦）が、プレイヤーは**クオーター毎のポーカー**でチームを強化する。

前身 `developsecond/basketball-sim`（観戦専用シミュレーター、commit 76c9eca）から本体を移植し、
ゲーム面の機能を足していく。設計とフェーズは [workPlan.md](workPlan.md)、作業ログは
[work-record.md](work-record.md) を参照。

## セットアップ

```bash
npm install
npm run dev      # http://localhost:5173
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | Vite 開発サーバー |
| `npm run build` | 型チェック + `dist/` へビルド |
| `npm run preview` | ビルド結果の確認 |
| `npm run typecheck` | 型チェックのみ |

## 構成

```
src/
  main.ts        エントリ（エンジン/シーン/レンダーループ）
  game.ts        試合の中核ステートマシン
  ai/            試合中の判断（オフェンス/ディフェンス/オフボール/ラインナップ）
  move/          ムーブ実行（走る・跳ぶ・シュート・パス）と判定（ブロック/ファウル/リバウンド）
  animation/     アニメ（部位の基本ルール / アクション別 / リアクション別）
  poker/         ポーカー強化（cards/hands/effects/state/ai）— Babylon にも DOM にも依存しない
  objects/       実体（Player/Ball/court/materials）
  systems/       状態を持つ機能（FT/ティップオフ/インバウンド/交代/審判）
  core/          共有状態を操作する手続き（衝突/ルーズ/デッドボール/ゲームフロー/表示）
  data/          生成データ（実クラブ / 選手DB 4015人）
  ui/            DOM オーバーレイ（タイトル/試合前/HUD/ポーカー/リザルト）
  rng.ts         シード付き擬似乱数（ポーカーなど再現性が要る箇所で使う）
vendor/objcts/   選手モデル・モーションの共有ライブラリ（scripts/sync-objcts.mjs で取り込む）
headless_sim/    ブラウザ無しでロジックを実測するプローブ群
```

## ポーカー強化

- 試合開始前に5枚配られ、**各クオーター開始前に1回ずつ交換**できる（計4ラウンド）。
- **捨てた札はその場で選手個人を強化**する（スートが能力の系統、ランクが量を決める。
  同じ札でもその能力が高い選手ほど大きく伸びる）。
- **役を確定させるタイミングはホームチームが決める**。確定した瞬間に両チームの手が公開され、
  役に応じたチーム強化が試合終了まで乗る。早く確定すれば長く効き、引っ張れば強い役を狙える。
- 「ポーカー: 自分で打つ ⇄ CPU同士」は試合前画面のボタンで切り替える。
- バランスのノブは `src/poker/effects.ts` に集約（`HAND_BUFF` / `DISCARD_BASE` / `MAX_DISCARDS`）。

## ヘッドレス検証

ブラウザ無しでロジックを実測できる。例:

```bash
npx esbuild headless_sim/probe-poker.ts --bundle --platform=node --format=esm \
  --outfile=headless_sim/probe-poker.mjs && node headless_sim/probe-poker.mjs
```

`probe-poker.ts` は役判定を 52C5 の全列挙で理論値と照合する。
`probe-poker-balance.ts` は実際の試合を回してポーカーの勝率への影響を測る（`MODE=off|both|one|max`）。
見た目・演出の確認はブラウザ実機でしか行えない。
