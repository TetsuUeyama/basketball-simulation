# basketball-simulation

ヘッドレス（ブラウザ無し）で動くバスケットボールシミュレーション。Node + TypeScript。

現状は雛形のみ。シミュレーション本体は未実装。

## 必要環境

- Node.js 22.6 以上（Node の型ストリッピングで `.ts` をそのまま実行する）
- 動作確認したバージョン: Node v23.11.0 / TypeScript 5.9.3

型ストリッピングは Node 側では experimental 扱いのため実行時に警告が出る。`npm start` / `npm run dev` では `--disable-warning=ExperimentalWarning` で抑止している。

## セットアップ

```bash
npm install
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm start` | `src/index.ts` を実行 |
| `npm start -- --seed=123` | シードを指定して実行 |
| `npm run dev` | ファイル変更を監視して再実行 |
| `npm run typecheck` | 型チェックのみ（`tsc --noEmit`） |
| `npm run build` | `dist/` へ JS を出力（`node dist/index.js` で実行できる） |

## 構成

```
src/
  index.ts   エントリポイント（引数の読み取りと main）
  rng.ts     シード付き擬似乱数（mulberry32）
```

## 方針メモ

- 相対 import は `./rng.ts` のように拡張子付きで書く（Node の型ストリッピングの要件）。`npm run build` 時に tsc が `.js` へ書き換える。
- `erasableSyntaxOnly` を有効にしているため、`enum` / `namespace` / コンストラクタのパラメータプロパティは使えない。型として消える構文のみを使う。
- 乱数は必ず `createRng(seed)` 経由で取り、`Math.random()` は使わない（実行結果を再現可能に保つため）。
