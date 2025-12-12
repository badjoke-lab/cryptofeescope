# CoinGecko Demo API Coverage (CryptoFeeScope 用メモ)

最終更新日: 2025-12-12  
対象: CoinGecko **Demo API** + `/api/v3/simple/price` + `vs_currencies=usd,jpy`  
認証: `x-cg-demo-api-key: <DEMO_KEY>` ヘッダ

CryptoFeeScope で **「無料の Demo プランのままどのチェーンまで扱えるか」** を確認するために、
主要チェーンの `id` をまとめて `/simple/price` に投げて挙動を記録した。

このファイルは、

- Demo で使えるチェーンと、
- Demo では価格が取れないチェーン（例：Polygon）

を一覧化し、**掲載チェーン選定の基準・履歴**として残すためのもの。

---

## 1. テスト条件

- 使用エンドポイント:  
  `GET https://api.coingecko.com/api/v3/simple/price`
- クエリパラメータ:
  - `ids` … 複数チェーンの CoinGecko ID をカンマ区切りで指定
  - `vs_currencies=usd,jpy`
- 認証:
  - HTTP ヘッダ `x-cg-demo-api-key: <DEMO_API_KEY>`
- 実行日時:
  - 2025-12-12 付近（ログ取得時点）

### 使用スクリプト（簡略版）

※ 実際には `cg_demo_scan.js` としてリポジトリに配置する想定。

```js
const API_KEY = process.env.COINGECKO_API_KEY;
const CANDIDATE_IDS = [ /* 下記リスト参照 */ ];

async function main() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?" +
    new URLSearchParams({
      ids: CANDIDATE_IDS.join(","),
      vs_currencies: "usd,jpy",
    }).toString();

  const res = await fetch(url, {
    headers: {
      "x-cg-demo-api-key": API_KEY,
      Accept: "application/json",
    },
  });

  const data = await res.json();

  for (const id of CANDIDATE_IDS) {
    const entry = data[id];
    if (!entry) {
      console.log(`- ${id}: ❌ no key`);
      continue;
    }
    const hasUsd = typeof entry.usd === "number";
    const hasJpy = typeof entry.jpy === "number";
    if (hasUsd || hasJpy) {
      console.log(`- ${id}: ✅ OK (usd=${entry.usd}, jpy=${entry.jpy})`);
    } else {
      console.log(`- ${id}: ⚠️ empty { }`);
    }
  }
}

main().catch(console.error);
````

---

## 2. Demo で価格取得できるチェーン一覧（✅）

### 2-1. メジャー L1 / L0

| CoinGecko ID   | 注記             |
| -------------- | -------------- |
| `bitcoin`      | BTC            |
| `ethereum`     | ETH            |
| `binancecoin`  | BNB / BSC      |
| `solana`       | SOL            |
| `ripple`       | XRP            |
| `cardano`      | ADA            |
| `dogecoin`     | DOGE           |
| `litecoin`     | LTC            |
| `tron`         | TRX            |
| `avalanche-2`  | AVAX (C-Chain) |
| `polkadot`     | DOT            |
| `chainlink`    | LINK           |
| `stellar`      | XLM            |
| `monero`       | XMR            |
| `bitcoin-cash` | BCH            |
| `eos`          | EOS            |
| `tezos`        | XTZ            |
| `algorand`     | ALGO           |
| `filecoin`     | FIL            |
| `cosmos`       | ATOM           |

### 2-2. EVM サイドチェーン・その他 L1

| CoinGecko ID       | 注記     |
| ------------------ | ------ |
| `fantom`           | Fantom |
| `cronos`           | Cronos |
| `hedera-hashgraph` | Hedera |
| `near`             | NEAR   |

### 2-3. L2 / Rollup / 新しめチェーン

| CoinGecko ID         | 注記 (ざっくり)      |
| -------------------- | -------------- |
| `arbitrum`           | Arbitrum (ARB) |
| `optimism`           | Optimism (OP)  |
| `metis-token`        | Metis          |
| `gnosis`             | Gnosis Chain   |
| `kava`               | Kava           |
| `linea`              | Linea          |
| `scroll`             | Scroll         |
| `mantle`             | Mantle         |
| `blast`              | Blast          |
| `aptos`              | Aptos          |
| `sui`                | Sui            |
| `sei-network`        | Sei            |
| `celestia`           | Celestia       |
| `injective-protocol` | Injective      |
| `flare-networks`     | Flare          |
| `base`               | Base           |

> メモ:
>
> * Arbitrum / Optimism など L2 は、「ガスは ETH だがトークン価格は ARB/OP」という問題がある。
>
>   * **手数料計算用には ETH 価格を使うのか、L2 トークン価格を使うのか** は別途仕様で明示すること。

---

## 3. Demo で価格が取得できないチェーン

### 3-1. `{}` だけ返ってくる（キーは存在するが usd/jpy がない）

| CoinGecko ID    | 状況                                                        |
| --------------- | --------------------------------------------------------- |
| `matic-network` | `{"matic-network": {}}` のみ返却。`usd` `jpy` 不在。Demo では価格非対応。 |

→ **Polygon (MATIC/POL) は Demo simple/price では価格が取得できない。**
CryptoFeeScope Phase1〜2 では「非対応チェーン」として扱う。

### 3-2. キー自体が存在しない（ID 不一致）

| CoinGecko ID | 状況                       |
| ------------ | ------------------------ |
| `polygon`    | `data["polygon"]` が存在しない |
| `zksync-era` | 同上                       |
| `toncoin`    | 同上                       |

→ 単純に **ID が違う** だけの可能性が高い。
（必要になった時点で CoinGecko サイトで正しい ID を調査してから再テストすること。）

---

## 4. CryptoFeeScope における運用方針

### 4-1. Phase1 / 無料 Demo 前提

* **「demo 互換チェーン」** = 上記 ✅ リスト
* CryptoFeeScope の **正式掲載チェーン候補はこの中から選ぶ**
* 特に問題なければ、初期は以下を想定:

  * BTC (`bitcoin`)
  * ETH (`ethereum`)
  * BNB (`binancecoin`)
  * SOL (`solana`)
  * TRX (`tron`)
  * AVAX (`avalanche-2`)
  * XRP (`ripple`)
  * Arbitrum (`arbitrum` or gas=ETH)
  * Optimism (`optimism` or gas=ETH)

### 4-2. Polygon (MATIC/POL) の扱い

* 現状 (`2025-12-12`) の Demo API では

  * `matic-network` … `{}` しか返らず、価格が取れない
  * `polygon` … キー自体が存在しない
* よって、仕様としては:

> - Phase1/2: **「Polygon PoS は非対応」** と明記
> - UI: 表示しない or 「Coming soon (Demo API limitation)」などの表示にとどめる
> - 将来: 有料プラン or 別プロバイダ採用時に再検討

### 4-3. 新規チェーン追加時のチェック手順

チェーンを追加したくなったら、必ず以下のフローを通す：

1. CoinGecko サイトで候補チェーンの ID を調べる
   例: `litecoin`, `gnosis`, `sei-network` など

2. `cg_demo_scan.js` の `CANDIDATE_IDS` に ID を追加

3. ローカルで実行:

   ```bash
   export COINGECKO_API_KEY="(Demo キー)"
   node cg_demo_scan.js
   ```

4. 出力結果を確認し、以下のように分類:

   * `✅ OK` … 掲載候補にしてよい（Demo で usd/jpy が返っている）
   * `⚠️ empty { }` … Polygon と同じ。Demo では価格非対応 → 将来候補に回す
   * `❌ no key` … ID が違う or 非対応 → 正しい ID を調べ直すか諦める

5. `chains` 設定ファイル側に `demoCompat` 等のフラグを持たせ、
   UI/バックエンドは **`demoCompat === "ok"` のものだけを対象にする**

---

## 5. メンテナンスノート

* この結果は **2025-12-12 時点の Demo API の挙動** に基づく。
* CoinGecko 側の仕様変更により、

  * 対応チェーン
  * Demo / Pro の提供範囲
  * ID 命名
    が変わる可能性がある。
* 定期的（例: 数ヶ月に 1 回）に `cg_demo_scan.js` を再実行し、

  * 新たに OK になったチェーン
  * 逆に `{}` になってしまったチェーン
    がないか確認し、このドキュメントを更新すること。

---
