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

参照ドキュメント（リポジトリ内に既に存在している前提）:

- `spec.md`  
  → v2 fee engine の仕様（**今回は中身は実装しない。参照のみ**）
- `roadmap-internal.md`  
  → 開発ロードマップ（Phase 1〜4）
- `roadmap-public-draft-ja.md`  
  → 公開用ロードマップ草案（今回は触らなくてよい）
- `coingecko-demo-coverage.md`  
  → CoinGecko Demo カバレッジメモ（対応チェーンの参考）

---

## Task A — スナップショット生成スクリプトの正式化

**目的:**  
`data/fee_snapshot_demo.json` を **手作業ではなく Node スクリプトで再生成できる状態**にする。

### 要件

1. `scripts/generate_fee_snapshot_demo.js` を新規作成すること。

2. 使用する価格APIは **CoinGecko Demo API の `/api/v3/simple/price`** のみとする。  
   - ベースURL：`https://api.coingecko.com/api/v3/simple/price`  
   - `ids` と `vs_currencies=usd,jpy` を使用。  
   - 対応チェーンIDはコード内で配列/オブジェクトとして明示的に定義すること。

3. 価格を取得するチェーンIDは、`coingecko-demo-coverage.md` の  
   「Demoで OK（usd/jpy が取れる）」なものをベースにするが、  
   実際に使う ID はコード側で明示し、**不要なものは落としてよい**。

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
         "tiers": [
           { "label": "standard", "feeUSD": 2.7, "feeJPY": 400 }
         ],
         "source": {
           "price": { "provider": "coingecko-demo", "id": "bitcoin" }
         }
       }
     }
   }
```

5. 各チェーンの `feeUSD` / `feeJPY` は、シンプルでよいので
   **既存の `fee_consistency_test.js` と同等レベル**の計算ロジックにすること。

   * 例: BTC は `nativeFee = 0.00003 BTC` 固定、
     ETH は `gasLimit * gasPrice` のような簡易ロジックなど。

6. スクリプトは標準出力に JSON を書き出す。利用例を README に記載すること。

   ```bash
   node scripts/generate_fee_snapshot_demo.js > data/fee_snapshot_demo.json
   ```

7. 価格取得に失敗したチェーンは `chains` から除外するか、
   `status: "unavailable"` として安全にスキップできるようにする。

---

## Task B — Phase 1 Frontend polish

*(numbers, tiers entrypoint, responsive layout)*

**目的:**
Cloudflare Pages 上の UI を「最低限、公開に耐える」レベルまで整える。
特に **手数料の表示方法 / tierの入口 / スマホ & PC レイアウト** に集中する。

### B-1. Fee number formatting（小さい値は `< 0.000001` 方式）

`app.js` 内の `formatFiat` 相当の関数を、以下の仕様で書き換える。

* 入力: `value: number | null | undefined`
* 戻り値: 表示用の **プレーンテキスト文字列**

ルール:

1. `value == null` または `NaN` → `"—"` を返す。

2. `abs = Math.abs(value)` とする。

3. **超小さい値（しきい値）**

   * もし `0 < abs < 1e-6 (0.000001)` の場合、
     セルの表示は常に `"< 0.000001"` とする。

   * このとき、セルの `title` 属性に **正確な数値＋通貨コード** を入れること。
     例: `title="0.000000000123 USD"`。

   > 科学的記法（`1.23e-4` など）は **使用禁止**。
   > ユーザーは e 記法に慣れていない前提とする。

4. **小さいがしきい値以上の値**

   * `1e-6 <= abs < 0.01` の場合は `value.toFixed(6)` を使う。
   * 表示前に `末尾の0と余分な小数点` を削ってよい。
     例: `"0.010000"` → `"0.01"`, `"0.000100"` → `"0.0001"`。

5. **通常の範囲**

   * `0.01 <= abs < 1000` → `value.toFixed(3)` を使う。
     末尾0をそのまま残すかどうかは任意（どちらでも可）。

6. **大きい値**

   * `abs >= 1000` → `k` / `m` の簡易表記にする。
   * 例:

     * `1234` → `"1.23k"`
     * `45678` → `"45.7k"`
     * `1234567` → `"1.23m"`

7. **符号**

   * 負の値が来た場合は、先頭に `-` を付ける。
     （負の fee は想定しないが、保険として。）

テーブル側の実装ルール:

* Feeセルの表示は `textContent` で入れる（XSS防止）。
* 同時に `title` 属性にフルの値＋通貨コードを入れる。
  例: `title="2.76963 USD"` や `title="0.000000000123 USD"`。

### B-2. Tier handling（Phase 1 は入口だけ）

* スナップショット JSON には `tiers`（配列）が存在しうる前提とする。

* **Phase 1 で必要なこと:**

  1. `tiers[0]` を “standard” tier とみなし、現在の Fee 列にはこの値を表示する。
  2. もし `tiers.length > 1` の場合、Feeセル内に
     「tierが複数ある」ことが分かる小さなテキストを追加する。
     例: `"Standard · +2 tiers"` など。

* まだ **モーダル / ドロップダウンの実装は不要**。
  後で tier 詳細を実装できるようにするための“目印”だけ用意する。

### B-3. レイアウト調整（モバイル & デスクトップ）

* デスクトップでは現在の **2カラム構成（左: Snapshot controls / 右: テーブル）を維持**。

* モバイル（幅 768px 以下、特に最小幅 360px のスマホ）では：

  * カードが縦方向に積み上がるようにし、**横スクロールが発生しない**ようにする。
  * 必要に応じて次のようなCSSを追加:

    * `html, body { overflow-x: hidden; }`
    * テーブルは親コンテナ幅内に収まるようにし、余計な左右マージンや固定幅で溢れないようにする。

* コンテナの推奨:

  * デスクトップ: `max-width` 960〜1200px 程度、左右パディング 24px 前後。
  * モバイル: パディング 16px 前後。

### B-4. 左側パネルのスカスカ感の緩和（機能は増やさない）

* 左の「Snapshot controls」カードは、**現状の内容に少しテキストを足す程度**にとどめる。

* 追加する内容の例（テキストのみ、機能実装なし）:

  * 1〜2行で「このテーブルが何を示しているか」の説明を補足。
  * 小さな “Coming soon” セクションとして:

    * `Token search & bridge hints will appear here in later versions.`
      のような一文を入れる。

* **検索ボックスや実際の検索機能は Phase 1 では実装しない。**
  あくまで UI テキストだけで空白を埋める。

### B-5. 既存ID & 挙動を壊さない

以下のIDは **今の動作を維持** すること（イベントハンドラも含む）。

* `#fee-table-body`, `#fee-header`
* `#currency-usd`, `#currency-jpy`
* `#refresh-button`, `#themeBtn`, `#updated-label`

`loadSnapshotAndRender()` の内部ロジックは基本的にそのまま使うが、

* `#updated-label` は必ず `snapshot.generatedAt` を元に更新するようにしてよい。

---

## Task C — ドキュメント整備（Phase 1 分）

**目的:**
Phase 1 の状態が外部から見ても分かるように、ドキュメントを揃える。

### 要件

1. `README.md` に **現状の機能** と **手動更新フロー** を追記する:

   * どのチェーンを扱っているか（例: BTC / ETH / BNB / SOL / XRP / Tron / Arbitrum / Optimism / Avalanche / Polygon など）
   * どうやって `fee_snapshot_demo.json` を更新するか:

     * 例: `node scripts/generate_fee_snapshot_demo.js > data/fee_snapshot_demo.json`
   * 必要な環境変数:

     * `COINGECKO_API_KEY`（Demoキーでも可）

2. `docs/fee_snapshot_schema.md` を新規作成し、
   スナップショットJSONのフィールド説明を簡潔に書くこと（英語推奨）。

3. `spec.md` と `roadmap-internal.md` には **触れない**（参照専用）。

---

## Task D — 後続フェーズのためのメモ（実装はまだ）

> 実装はしなくてよい。コード内コメントか
> `docs/notes-phase2+.md` のようなファイルで、将来の勘所を残しておく。

* 将来的に `SNAPSHOT_URL` を環境変数ベースで切り替え可能にする
  （静的JSON → Cloudflare Worker 共通API）。
* 後のフェーズで 24h変化率など追加項目（例: `priceChange24hPct`）を入れても
  既存UIが壊れないように、`renderTable` は **未知のフィールドに対して寛容** に書いておく。
* WCWD との共通API（`/v1/{service}/{endpoint}`）導入は **Phase 2 以降で行う** ことを明記する。

---
