## 🔧 CryptoFeeScope Internal Roadmap（開発者向け）

> 対象：CryptoFeeScope 本体 + 将来の共通API連携（wcwd含む）
> ホスティング：Cloudflare Pages（本体）、Cloudflare Workers（共通API予定）
> データソース：CoinGecko Demo/API（当面）

### 0. 全体の段階イメージ

* **Phase 1**：Snapshot MVP（現在値ダッシュボードを Cloudflare で安定公開）
* **Phase 1.5**：UI & データ情報量の微強化（24h変化率など）
* **Phase 2**：Common API v1（Cloudflare Worker 化 /v1/fees/current）
* **Phase 3**：X Bot v1（テキストのみ・1日1回〜数回）
* **Phase 4**：History & Charts v1（簡易履歴＋グラフ）

---

## 1. Phase 1 — Snapshot MVP（現在値版を公開まで持っていく）

**目的**

* 「今この瞬間の手数料＆速度」を一覧で見られるツールとして**普通に公開できるレベル**まで持っていく。
* まだ共通API・履歴・Botは入れない。

**現状**

* `data/fee_snapshot_demo.json` で値は取れている。
* `app.js` で Cloudflare Pages 上にテーブル表示できている（USD/JPY切替・テーマ切替あり）。

### Phase 1 のタスク

**1-1. フロントエンド仕上げ**

* [ ] テーブルUIの微調整

  * モバイル 360px 基準で「1画面にある程度収まる」レイアウト
  * チェーン名・ticker・fee・速度・status・更新時刻のバランス調整
* [ ] Statusバッジの色分け（CSS）

  * `status-fast / status-normal / status-slow / status-degraded` など
  * 文字色 or バッジ風の背景色をつける
* [ ] ヘッダーの「Updated」を `snapshot.generatedAt` 連動にする

  * 現在のラベル更新処理を確認して、値のフォーマットを統一

**1-2. スナップショット生成フローの整理**

* [ ] `scripts/generate_fee_snapshot_demo.js` をリポジトリ内の正式パスに配置

  * 例：`/scripts/generate_fee_snapshot_demo.js`
* [ ] README に「手動更新フロー」を明記

  * `node scripts/generate_fee_snapshot_demo.js > data/fee_snapshot_demo.json`
  * どの環境変数をセットすればいいか（`COINGECKO_API_KEY`）。
* [ ] `fee_snapshot_demo.json` の中身が「最低限このキーは必須」というラインを決める

  * `generatedAt, vsCurrencies, chains[chainKey].{label, feeUSD, feeJPY, speedSec, status, updated, native, tiers, source}`

**1-3. ドキュメント（内部）**

* [ ] `docs/fee_snapshot_schema.md` を作成

  * JSON構造の仕様
  * 各フィールドの意味
  * どこまで必須／任意か
* [ ] `docs/roadmap-internal.md` にこのロードマップを保存（今回の内容）

**Phase 1 完了条件**

* Cloudflare Pages で 404/JSエラーなしで表示
* BTC / ETH / BNB / SOL / XRP / 他採用チェーンの値がちゃんと出る
* README + docs に更新方法とスキーマが書いてある
* 「今見せても恥ずかしくない最低ライン」として自分で納得できる

**スケジュール目安**

* 作業時間 1〜2h/日ペースで **1〜2週間以内** に終わらせる目標。

---

## 2. Phase 1.5 — UI & Lite Metrics（UI調整＋24h変化率）

**目的**

* 「瞬間値だけだと弱い」を少し補強するフェーズ。
* まだ履歴保存や共通APIはやらず、スナップショットの情報量を増やす。

### Phase 1.5 タスク

**2-1. 24h 変化率の追加**

* [ ] CoinGecko から `price_change_percentage_24h` 相当の値を取得（簡易でOK）

  * 取れなければ「直近24h高値・安値」など別の指標も検討
* [ ] `generate_fee_snapshot_demo.js` を修正し、
  各チェーンに `priceChange24hPct` を追加
* [ ] UIに「24h変化」列 or アイコンを追加

  * 例：`+3.2%` / `-1.8%` + 上下矢印

**2-2. 軽いUX改善**

* [ ] ステータスの凡例（legend）追加

  * `fast = 〜秒以内 / slow = 〜以上` などざっくり説明
* [ ] スマホでの可読性を再チェック

  * 横スクロールになりすぎないように工夫
* [ ] 英語ラベルの最終調整（公開版にそのまま使えるレベルにする）

**Phase 1.5 完了条件**

* スナップショットに `priceChange24hPct` が入っている
* UIで「今日の方向感」がざっくり見える
* まだ静的JSON方式だが、「瞬間値ツールとしては一段階強い」状態

**スケジュール目安**

* Phase 1 完了後の **1週間以内** にやり切るイメージ。

---

## 3. Phase 2 — Common API v1（Cloudflare Worker）

**目的**

* CoinGecko へのアクセスを Cloudflare Worker に集約して、
  **CryptoFeeScope＋今後の wcwd が共通で使えるデータ基盤**にする。

### 設計（docs 前提）

**3-0. 共通API仕様書**

* [ ] `docs/common-api-v1.md` を作成

  * ベースURL（例）：`https://<project>.workers.dev`
  * パス命名：`/v1/{service}/{endpoint}`
  * 共通レスポンス：

    ```jsonc
    {
      "ok": true/false,
      "ts": "ISO8601",
      "cacheSec": 60,
      "data": { /* サービスごとの中身 */ },
      "error": null | { "code": "UPSTREAM_DOWN", "message": "..." },
      "source": { "provider": "coingecko", "plan": "demo|free|pro", "rawTs": "..." }
    }
    ```
  * 想定エラーコード一覧：

    * `UPSTREAM_DOWN`
    * `RATE_LIMITED`
    * `BAD_REQUEST`
    * `INTERNAL`
  * キャッシュ方針：`cacheSec` はとりあえず 60〜300 秒程度

### 実装タスク

**3-1. Worker プロジェクト作成**

* [ ] `wrangler` で新規 Worker プロジェクトを作成
* [ ] `COINGECKO_API_KEY` を環境変数に設定（Demo/Proどちらでも）

**3-2. `/v1/fees/current` エンドポイント実装**

* [ ] Worker 内にスナップショット生成ロジックを移植

  * 現行 `generate_fee_snapshot_demo.js` をベースにする
* [ ] メモリ or KV でキャッシュ（最低限メモリでOK）

  * `lastSnapshot` + `lastFetchedAt` を保持
* [ ] レスポンスを共通フォーマットに整形

  * `data.snapshot` に fee_snapshot を載せる形を想定

**3-3. CryptoFeeScope のデータ取得先を切り替え**

* [ ] `app.js` の `SNAPSHOT_URL` を切り替え可能にする

  * `SNAPSHOT_URL = "/data/fee_snapshot_demo.json"`（ローカル用）
  * `SNAPSHOT_URL = "https://<worker>/v1/fees/current"`（本番用）
    どちらかを `ENV` や簡易フラグで切替
* [ ] Worker モードで正常に表示されることを確認

  * レート制限・CORS・エラー表示を軽くチェック

**Phase 2 完了条件**

* CryptoFeeScope が **共通API（Worker）経由でも問題なく動く**
* エラー時に「Error loading data」だけでなく、
  簡単な理由が分かるようなログが出ること
* `docs/common-api-v1.md` が存在し、将来 wcwd も参照できる

**スケジュール目安**

* Worker に慣れる前提で **2〜3週間くらいの枠**を見ておく。
  （実作業時間はもっと短いが、他プロジェクトとの兼ね合い込み）

---

## 4. Phase 3 — X Bot v1（シンプル版）

**目的**

* サイトを開かなくても、**X のタイムライン上で手数料状況を見られる**状態を作る。
* 最初は **テキスト投稿だけ** の極力シンプルなBot。

### 前提

* `/v1/fees/current` が安定していること
* X API / 連携方式の方針決定（完全自動 or 半自動）

### 実装タスク

**4-1. Bot の役割と頻度を決める（内部仕様）**

* [ ] 1日1回 or 数時間に1回
  → 無理ない頻度を決める
* [ ] 投稿内容のフォーマット

  * 例：

    * 「現在の手数料が最も安いチェーン TOP3」
    * 「ETH/BTC の現在手数料 + 24h変化」
* [ ] 完全自動 / テキストだけ生成して手動ポスト どちらにするか決める

**4-2. データ取得＋整形スクリプト**

* [ ] Node.js スクリプト or Cloudflare Worker から `/v1/fees/current` を叩く
* [ ] 取得データから投稿テキストを生成

  * 日本語 or 英語 or 両方（優先言語を決める）

**4-3. 実際のポスト手段**

* パターンA：**人力＋Copilot方式**

  * スクリプトが投稿文を生成 → あなたがXにコピペ → 当面はこれでもよし
* パターンB：**X API / 外部サービスで自動投稿**

  * ここは料金やAPI仕様に依存するので、その時点の状況を見て判断

**Phase 3 完了条件**

* 最低でも「スクリプトを一発叩けば、その時点の状況を要約したX向けテキストが出る」状態。
* 可能なら、自動 or 半自動で1日1回投稿が回る状態。

**スケジュール目安**

* 共通APIが安定した後、**1〜2週間程度**で v1 は作れる想定。

---

## 5. Phase 4 — History & Charts v1（履歴＋グラフ）

**目的**

* 「今」だけでなく、**過去の傾向を見られるツール**に進化させる。
* ただしガチガチの分析ツールまでは行かず、
  **手数料の“ラフな推移”が分かる程度**を目標にする。

### 設計タスク

**5-1. 履歴仕様の決定**

* [ ] どの粒度で保存するか

  * 例：15分 / 1時間 / 4時間 など
* [ ] 保存期間の目安

  * 例：直近7日 or 30日
* [ ] 保存する指標

  * feeUSD / feeJPY
  * 24h変化率
  * ステータス（fast/slow） など

### 実装パターン（段階的）

**Stage A：簡易履歴（静的JSON）**

* [ ] `data/fee_history_demo.json` のような形で、
  スナップショットを配列で保存
* [ ] 1チェーン or 少数チェーンだけでもよいので、
  フロントに簡易折れ線グラフを表示（チャートライブラリ1つ）

**Stage B：共通APIに `/v1/fees/history` 追加**

* [ ] Cloudflare Worker に履歴保存ロジックを追加

  * Scheduled Worker or 何らかのトリガーで定期的にスナップショット保存
* [ ] `GET /v1/fees/history?range=7d` などで履歴取得できるようにする
* [ ] フロントのグラフをAPIバックエンドに切り替え

**Phase 4 完了条件**

* 最低限、「1つ〜数チェーンについて、過去数日分のfee推移グラフを見られる」状態。
* データ保存・API・UIが全部繋がっている。

**スケジュール目安**

* Stage A：他プロジェクトと並行で **数週間**
* Stage B：共通APIの拡張含めて、別途 **1ヶ月くらいの塊** として見るのが現実的。

---

## 6. 優先度まとめ（疲れないための順番）

1. **Phase 1**：今の Snapshot MVP を「公開できる形」まで持っていく
2. **Phase 1.5**：24h変化率＋UI微調整（“瞬間値だけ問題”をちょっと緩和）
3. **Phase 2**：共通API v1（/v1/fees/current）を Worker で実装
4. **Phase 3**：X Bot v1（最初はテキスト生成 → 余裕があれば自動投稿）
5. **Phase 4**：履歴＆グラフ（まず静的JSON → その後API）

---
