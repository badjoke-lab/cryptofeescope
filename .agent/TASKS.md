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

## Task B-1′ — Fee number formatting 完全対応

**目的（Goal）**
`app.js` の Fee 表示ロジックを、これまで決めたルールどおりに **最後まで実装** する。
「小さい値は `< 0.000001` 表示＋ツールチップ」「大きい値は k / m 省略」などをすべて反映させる。

**対象ファイル**

* `app.js` のみ（既存の HTML / CSS 構造は壊さないこと）

**やること（What to do）**

1. `formatFiat(value)` を、次の仕様で書き換える。

   * 入力: `number | null | undefined`
   * 戻り値: **表示用文字列（プレーンテキスト）**

   ルール:

   1. `value == null` または `NaN`
      → `"—"` を返す。

   2. `abs = Math.abs(value)` を使う。

   3. **超小さい値**

      * `0 < abs < 1e-6`（= 0.000001） の場合
        → 常に文字列 `"< 0.000001"` を返す。
        → 科学的記法（`1.23e-4` 等）は一切使わない。

   4. **小さいがしきい値以上**

      * `1e-6 <= abs < 0.01` の場合
        → `value.toFixed(6)` を基準にし、末尾の `0` と不要な小数点を削ってよい。
        例: `"0.010000"` → `"0.01"`, `"0.000100"` → `"0.0001"`。

   5. **通常の範囲**

      * `0.01 <= abs < 1000` の場合
        → `value.toFixed(3)` を返す（`1.860` など）。
        末尾0を残すかどうかはどちらでもよいが、実装内で統一すること。

   6. **大きい値**

      * `abs >= 1000` の場合
        → `k / m` 省略表記にする。

        例（小数2桁程度でOK）:

        * `1234` → `"1.23k"`
        * `45678` → `"45.7k"`
        * `1234567` → `"1.23m"`

   7. **符号**

      * 負の値の場合は、先頭に `-` を付ける（`-1.23k` など）。

2. Feeセルに **ツールチップで正確な値を入れる処理** を追加する。

   * `renderTable()` 内で Fee を描画している箇所を修正し、

     * 表示には `formatFiat(fee)` の戻り値を使う。
     * 同じ `td` に `title` 属性を付け、そこに **生の値＋通貨コード** を入れる。

       例（USD表示中）:

       ```html
       <td class="fee-cell" title="0.000000000123 USD">0.000001</td>
       ```

   * ツールチップの内容は、少なくとも
     `"{rawValue} {CURRENCY}"` 形式にすること。
     （`rawValue` は丸め前の数値を文字列化したもの。）

3. 既存のIDやイベント（`#fee-table-body`, `#fee-header` 等）は変更しない。

### B-2. Tier handling（Phase 1 は入口だけ）

* スナップショット JSON には `tiers`（配列）が存在しうる前提とする。

* **Phase 1 で必要なこと:**

  1. `tiers[0]` を “standard” tier とみなし、現在の Fee 列にはこの値を表示する。
  2. もし `tiers.length > 1` の場合、Feeセル内に
     「tierが複数ある」ことが分かる小さなテキストを追加する。
     例: `"Standard · +2 tiers"` など。

* まだ **モーダル / ドロップダウンの実装は不要**。
  後で tier 詳細を実装できるようにするための“目印”だけ用意する。

## Task B-2′ — Tier入口の UI 実装

**目的（Goal）**
`tiers` が存在するチェーンについて、テーブルから **「複数tierがある」ことが分かる入口** を用意する。
このタスクでは、モーダルや詳細ポップアップまでは作らない。

**対象ファイル**

* メイン: `app.js`
* 必要であれば、見た目調整のために `style.css` に **小さなクラス追加のみ可**
  （既存クラスの大改造はしない）

**やること（What to do）**

1. `renderTable()` を、`tiers` を考慮したロジックに修正する。

   * 各 `chain` につき、次のように判断する：

     ```js
     const hasTiers = Array.isArray(chain.tiers) && chain.tiers.length > 0;
     ```

   * **Standard tier として使う値**

     * `hasTiers` の場合:

       * `const baseTier = chain.tiers[0];`
       * Fee表示に使う値は `baseTier.feeUSD / baseTier.feeJPY`。
     * `hasTiers` でない場合:

       * これまでどおり `chain.feeUSD / chain.feeJPY` を使う。

   * Feeセル表示用テキスト:

     * `const displayFee = formatFiat(selectedFee);` を使う。

2. **複数tierがあることを示すヒントテキスト** を Feeセルに追加する。

   * `hasTiers && chain.tiers.length > 1` の場合:

     * `extraCount = chain.tiers.length - 1` を計算し、
     * Feeセルの中に小さなサブテキストを追加する。

       例:

       ```html
       <td class="fee-cell" title="...">
         0.000005
         <div class="fee-tier-hint">Standard · +2 tiers</div>
       </td>
       ```

   * この `fee-tier-hint` 用のCSSを `style.css` に追加してよい（フォントサイズを小さく / 色を薄くする程度）。

3. Feeセルの `title` には、tier情報も含める。

   * `hasTiers` の場合は、簡単なテキストでよいので tier 列挙を入れる。

     例:

     ```text
     Standard: 0.000005 XRP; Fast: 0.000010 XRP; Slow: 0.000020 XRP
     ```

   * `hasTiers` でない場合は、従来どおり
     `"0.012 USD"` など単一値だけでよい。

4. **スコープから外すこと**

   * モーダル表示・詳細ポップオーバーなどのリッチUIはここでは実装しない。
   * tiers に応じて行の高さやレイアウトを大きく変えるリファクタはしない。
   * Worker / 共通API / 自動更新ロジックには触れない。

**完了条件（Done）**

* `data/fee_snapshot_demo.json` に `tiers` があるチェーンで：

  * テーブルの Fee列が `tiers[0]` ベースの値を表示している。
  * `tiers.length > 1` の行には「Standard · +N tiers」風のヒントが出ている。
  * Feeセルの `title` に、tier一覧または正確なfeeの情報が入っている。

* `tiers` のないチェーンは、これまでと同じように表示される（壊れていない）。

* スマホ（幅360px）でも、tierヒントの追加によって横スクロールが発生していない。

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

## Task D — 24h 変化率の追加（Phase 1.5, Part 1）

**目的（Goal）**
CoinGecko Demo API から各チェーンの **24時間価格変化率** を取得し、
`scripts/generate_fee_snapshot_demo.js` とフロントエンド両方に反映する。

**やること（What to do）**

1. **スナップショット生成スクリプトの拡張**

   * `scripts/generate_fee_snapshot_demo.js` を修正し、CoinGecko `/simple/price` を叩く際に
     `include_24hr_change=true` を付けてリクエストする。
   * レスポンス中の `usd_24h_change`（あれば `jpy_24h_change` も）を読み取り、
     各チェーンごとに `priceChange24hPct` プロパティを追加して `fee_snapshot_demo.json` に保存する。

     * 値は **USDベースの変化率** を優先（`number`。例: `3.25` = +3.25%）。
     * 取得できなかった場合は `null` またはプロパティ自体を省略する（どちらかに統一）。

2. **フロントエンドのテーブル列追加**

   * 現行のテーブルに **「24h change」列** を追加し、`priceChange24hPct` を表示する。
   * 表示ルール（例）:

     * `+3.2% / -1.8%` のように **符号付き・小数1桁** で表示。
     * 正の値は `class="change-pos"`、負の値は `class="change-neg"`、ほぼ0は `class="change-flat"` などCSSクラスで色分け。
   * モバイル 360px では、レイアウトが崩れる場合に備えて：

     * 必要であれば 24h 列を幅の小さいテキストにするか、
     * もしくは `@media (max-width: 480px)` でフォントを少し小さくする程度にとどめる。
     * **横スクロールが発生しないこと** を優先。

3. **ツールチップ・アクセシビリティ**

   * 24h列のセルに `title` 属性を付与し、内部値をそのまま表示（例: `title="+3.25% over last 24h"`）。
   * 値が `null` / 欠損の場合は `–` を表示し、`title` も「No 24h data (demo API)」のように分かる文言にする。

4. **ドキュメント軽修正**

   * README か `docs/fee_snapshot_schema.md` に `priceChange24hPct` フィールドを追記して、
     「CoinGecko Demo API から取得できた範囲でのみ埋まる補助指標」であることを書いておく。

**スコープ外（Out of scope）**

* 24h 以外の変化率（7d, 30dなど）
* 履歴保存やグラフ描画
* Cloudflare Worker / 共通API への移行（これは Task E 以降で扱う）

**完了条件（Done）**

* `data/fee_snapshot_demo.json` に全チェーン分の `priceChange24hPct` が追加されている（Demo API が返せる範囲）。
* テーブルに「24h change」列が表示され、値のあるチェーンでは `%` 表示が行われている。
* モバイル 360px 幅で **横スクロールが発生せず**、レイアウトが破綻していない。
* README / スキーマに新フィールドが明記されている。

---

## Task E — UI 追加調整＆ステータス凡例（Phase 1.5, Part 2）

**目的（Goal）**
Phase 1 のテーブル UI をさらに整えて、
特に **モバイル 360px での可読性** と **ステータスの意味の分かりやすさ** を改善する。

**やること（What to do）**

1. **Status バッジ凡例（Legend）の追加**

   * Snapshot controls カードの下部かテーブルの直上に、小さな凡例ブロックを追加する。
   * 例：

     * `Fast ≈ 数秒〜数十秒`
     * `Normal ≈ 数分`
     * `Slow ≈ 10分以上`
   * 既存の `status` クラス（`fast`, `normal`, `slow` など）と色が対応していることが分かるように表示。
   * 英語＋簡単な日本語の **併記**（例: `Fast（速い）`）にする。

2. **モバイル 360px レイアウトの再調整**

   * CSS（`style.css`）を調整し、360px 幅で次を満たすようにする：

     * テーブル全体に **横スクロールバーが出ない**。
     * チェーン名とティッカーは **2行までで折り返し**、それ以上は `text-overflow: ellipsis` 等で省略。
     * Fee / Speed / Status / Updated は **列幅が狭くなっても数字が読める** フォントサイズにする。
   * 必要であれば：

     * `table-layout: fixed;`
     * 一部列に `white-space: nowrap;` と `min-width` を設定し、
       それ以外の列に折り返しを許可する。

3. **ヘッダー＆スナップショット情報の整理**

   * ヘッダーの「Updated yyyy/mm/dd hh:mm:ss」は
     `fee_snapshot_demo.generatedAt` に連動していることを前提に、
     **日付と時刻のフォーマットを短めに統一**（例：`2024-06-01 21:00`）。
   * スマホでは Updated バッジの幅が広すぎて詰まって見える場合、

     * フォントサイズを一段階小さくする、
     * もしくは行を2段組（タイトル行＋Updated行）に分けるなど、
       文字が潰れないよう微調整。

4. **コピー微修正**

   * Snapshot controls カード内の説明文を、
     「Cloudflare Pages の preview build」「Demo snapshot」「CoinGecko Demo」などのキーワードを含みつつ、
     **2〜3文程度に短く整理**して読みやすくする。
   * 既存の About / Data Sources / Disclaimer へのリンクはそのまま利用。

**スコープ外（Out of scope）**

* ダークモードテーマの再設計（既存テーマ切り替えの範囲を超える変更）
* テーブル以外の新コンポーネント（カード型リスト等）への全面リデザイン
* Cloudflare Worker / 自動更新ロジックそのもの（別 Task 予定）

**完了条件（Done）**

* モバイル 360px 実機で：

  * 横スクロールが出ない。
  * 各行の主要情報（チェーン名 / Fee / Speed / Status / Updated / 24h）が
    無理なく読めるレイアウトになっている。
* ステータス凡例が追加され、「Fast / Normal / Slow 等の意味」が UI 上で分かる。
* Updated バッジの表示が読みやすく整理されている。
* テキスト（英語＋日本語）が「公開しても違和感のないレベル」に整っている。

---

## Task F — 後続フェーズのためのメモ（実装はまだ）

> 実装はしなくてよい。コード内コメントか
> `docs/notes-phase2+.md` のようなファイルで、将来の勘所を残しておく。

* 将来的に `SNAPSHOT_URL` を環境変数ベースで切り替え可能にする
  （静的JSON → Cloudflare Worker 共通API）。
* 後のフェーズで 24h変化率など追加項目（例: `priceChange24hPct`）を入れても
  既存UIが壊れないように、`renderTable` は **未知のフィールドに対して寛容** に書いておく。
* WCWD との共通API（`/v1/{service}/{endpoint}`）導入は **Phase 2 以降で行う** ことを明記する。

---


