# Fee snapshot schema (demo / CoinGecko)

このファイルは `public/data/fee_snapshot_demo.json` で配信されるスナップショット JSON のスキーマを定義します。Vercel / Next.js などのフロントエンドが直接読み込む想定です。

## ルートオブジェクト
- `generatedAt: string (ISO8601)` — スナップショット生成時刻
- `vsCurrencies: string[]` — 例: `["usd", "jpy"]`
- `chains: Record<string, ChainSnapshot>` — チェーンIDをキーにしたスナップショット一覧

## ChainSnapshot
- `label: string` — チェーンの表示名
- `feeUSD: number` — 手数料（USD換算）
- `feeJPY: number` — 手数料（JPY換算）
- `speedSec: number` — 目安となる確定までの秒数
- `status: "fast" | "normal" | "slow" | ...` — 表示用ステータス（文字列）
- `updated: string (ISO8601)` — チェーン個別の更新時刻
- `native: { amount: number; symbol: string }` — ネイティブ通貨での手数料とシンボル
- `tiers: { label: string; feeUSD: number; feeJPY: number }[]` — 手数料ティア（現状は `standard` のみ）
- `source: { price: { provider: string; id: string } }` — 価格の取得元情報

## 運用ルール
このスナップショットスキーマを拡張・変更する場合は必ずこのファイルを起点に更新してください。変更時はスキーマと実装、生成スクリプトの 3 点を同時に揃えること。

- フィールド追加・削除・型変更を行う場合は、必ず：
  1. `scripts/generate_fee_snapshot_demo.js` の出力形式を更新
  2. `docs/schema/fee_snapshot.md` を更新
  3. `src/types/feeSnapshot.ts` を更新
  の 3 点セットで変更すること。
