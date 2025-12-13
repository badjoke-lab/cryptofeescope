# TASKS — CryptoFeeScope Phase 1 (Snapshot MVP on Cloudflare)

## 🚫 Global rules（必読）

- 触っていいのは **このリポジトリ内だけ**。
- 既存の構成を壊さないこと。
- 大量リファクタリングは禁止。**Phase 1 で必要な最小限の追加・修正だけ**にする。
- 新規ファイルを作る場合は、原則として以下のどこかに置くこと：
  - `scripts/`（Nodeスクリプト）
  - `data/`（生成された JSON）
  - `docs/`（ドキュメント）
- Cloudflare 用のビルド設定がある場合は、それを前提にする（Next.js / 素のHTML等、実際の構成に合わせて対応してよい）。

参照ドキュメント（リポジトリ内に既に存在）:

- `spec.md` … v2 fee engine の仕様（**今回は中身は実装しない。参照のみ**）
- `roadmap-internal.md` … 開発ロードマップ（Phase 1〜4）
- `roadmap-public-draft-ja.md` … 公開用ロードマップ草案（今回は触らなくてよい）
- `coingecko-demo-coverage.md` … CoinGecko Demo カバレッジメモ（対応チェーンの参考）

---

## Task A — スナップショット生成スクリプトの正式化

目的:  
`data/fee_snapshot_demo.json` を **手作業ではなく Node スクリプトで再生成できる状態**にする。

### 要件

1. `scripts/generate_fee_snapshot_demo.js` を新規作成すること。
2. 使用する価格APIは **CoinGecko Demo API の `/api/v3/simple/price`** のみとする。
3. 価格を取りに行くチェーンIDは、`coingecko-demo-coverage.md` に書かれている  
   「Demoで OK（usd/jpy が取れる）」なものを基本としつつ、  
   実際のコード内では **配列/オブジェクトで明示的に定義**すること。
4. 出力する JSON の構造は、現在の `data/fee_snapshot_demo.json` と互換にすること。

   必須フィールド:
   ```jsonc
   {
     "generatedAt": "ISO8601",
     "vsCurrencies": ["usd", "jpy"],
     "chains": {
       "<key>": {
         "label": "Bitcoin",
         "feeUSD": 2.7,
         "feeJPY": 400,
         "speedSec": 600,
         "status": "normal",
         "updated": "ISO8601",
         "native": { "amount": 0.00003, "symbol": "BTC" },
         "tiers": [{ "label": "standard", "feeUSD": 2.7, "feeJPY": 400 }],
         "source": { "price": { "provider": "coingecko-demo", "id": "bitcoin" } }
       }
     }
   }
