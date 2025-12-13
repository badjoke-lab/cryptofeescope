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
````

5. 各チェーンの `feeUSD` / `feeJPY` は、シンプルでよいので **既存のテストスクリプトと同等レベル**の計算にすること。

   * 例: BTC は `nativeFee = 0.00003 BTC` 固定、ETH は `gasLimit * gasPrice` のような簡易ロジックなど。
6. 実行例（READMEに記載すること）:

   ```bash
   node scripts/generate_fee_snapshot_demo.js > data/fee_snapshot_demo.json
   ```

---

## Task B — Phase 1 フロントエンドの微調整

目的:
Cloudflare Pages 上の UI を「最低限、公開に耐える」レベルまで整える。

### 要件

1. 既存の `app.js` / `index.html` / `style.css`（実名はリポジトリ構成に合わせる）のうち、
   **次のID/クラスを壊さずに**見た目を調整すること:

   * `#fee-table-body`
   * `#fee-header`
   * `#currency-usd`, `#currency-jpy`
   * `#refresh-button`
   * `#themeBtn`
   * `#updated-label`
2. テーブルの列構成は現状維持でよいが、以下を追加・改善する:

   * `status-*` クラス（`status-fast`, `status-normal`, `status-slow`, `status-degraded` 等）に対して、
     **背景色 or ボーダー色によるバッジ風の表示**をCSSで追加。
   * モバイル幅（min-width: 360px）で、横スクロールしすぎないように調整。
3. `#updated-label` に表示する値は `snapshot.generatedAt` に基づくことを確認し、
   `loadSnapshotAndRender` 内の処理を必要に応じて微修正する。
4. 可能であれば、どこかに小さく **「Roadmapへのリンク」** を追加する（例: フッターに `/docs/roadmap-public` へのリンク）。

---

## Task C — ドキュメント整備（Phase 1 分）

目的:
Phase 1 の状態が外部から見ても分かるように、ドキュメントを揃える。

### 要件

1. `README.md` に **現状の機能** と **手動更新フロー** を追記する:

   * どのチェーンを扱っているか
   * どうやって `fee_snapshot_demo.json` を更新するか
   * 必要な環境変数 (`COINGECKO_API_KEY`)
2. `docs/fee_snapshot_schema.md` を新規作成し、
   スナップショットJSONのフィールド説明を日本語/英語どちらかで簡潔に書くこと。
3. `spec.md` と `roadmap-internal.md` には **触れない**（参照専用）。

---

## Task D — 後続フェーズのためのメモ（実装はまだ）

> 実装はしなくてよいが、コード内コメントまたは `docs/notes-phase2+.md` などに、
> 以下の“フック”だけ残しておくこと。

* 将来的に `SNAPSHOT_URL` を環境変数ベースで切り替えられるようにする（静的JSON → 共通API）。
* 24h変化率 `priceChange24hPct` を追加しても壊れないよう、
  `chains[key]` に未知のフィールドが増えても問題ない `renderTable` の書き方にしておく。

---
