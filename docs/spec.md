# 🧩 **1. spec.md　— CryptoFeeScope v2 完全仕様**

※ *これは Codex が最終的に作るべきロジックの仕様。
通常ChatGPTではなく Codex に最適化した書き方。*

---

# CryptoFeeScope v2 — Fee Logic Rebuild Specification

*(for Codex)*

## 🎯 **Objective**

Rebuild the entire fee estimation logic for all supported blockchains using **real-time API aggregation**, **fiat conversion validation**, and **automatic abnormal-value filtering**, producing **correct feeUSD values** guaranteed to be within realistic ranges for each chain.

Goal:

* **The final feeUSD must be correct.**
* Middle calculations (native gas, byte size, etc.) are irrelevant as long as feeUSD accuracy is maintained.

---

## 🟦 **Supported Chains**

* Bitcoin
* Ethereum (L1)
* BNB Smart Chain (BSC)
* Polygon PoS
* Avalanche C-Chain
* Solana
* XRP Ledger
* Arbitrum
* Optimism
* Base

---

## 🟧 **Core Requirements**

### 1. Multi-source Real-time API Fetch

For each chain:

* At least **2–4 independent API sources**
* Fetch gasPrice / fee / required parameters
* Attach timestamp
* Reject values older than **3 hours**
* Reject zero or near-zero gasPrice values
* Combine values using **median** or trimmed mean

### 2. Native Fee Calculation

Codex must implement proper chain-specific fee models：

* BTC: vBytes × sat/vB
* ETH/EVM: gasLimit × gasPrice
* L2: L2 gas + L1 data gas
* Solana: lamports
* XRP: drops

### 3. Fiat Conversion

```
feeUSD = feeNative × priceUSD
```

priceUSD must be:

* From CoinGecko + CryptoCompare + Binance API fallback
* No null allowed
* Must retry on error

### 4. USD Validity Ranges (critical)

Codex must enforce:

| Chain     | minUSD   | maxUSD |
| --------- | -------- | ------ |
| BTC       | 0.02     | 100    |
| ETH       | 0.02     | 20     |
| BSC       | 0.01     | 2      |
| Polygon   | 0.001    | 1      |
| Avalanche | 0.002    | 1      |
| Solana    | 0.0001   | 0.02   |
| XRP       | 0.000001 | 0.05   |
| Arbitrum  | 0.003    | 0.5    |
| Optimism  | 0.003    | 0.5    |
| Base      | 0.003    | 0.5    |

### 5. USD Outlier Filter

If feeUSD is outside the allowed range:

* Retry API
* Replace with fallback source
* Recalculate
* If still out of range:
  → Use **safe median** of fallback list
  → Mark as `"status": "estimated"`

### 6. Speed Estimation

* BTC: based on mempool feerate thresholds
* ETH/EVM: 30 sec / 2 min / 5 min tiers
* L2: finality = 5〜60 sec
* Sol/XRP: static (2〜6 sec / 4 sec)

### 7. Output Format

Codex must output:

```
{
  chain: string,
  feeNative: number,
  feeUSD: number,
  speedSec: number,
  status: "ok" | "estimated",
  updated: ISO8601
}
```

### 8. Tests (required)

Codex generates tests to verify:

* priceUSD != null
* feeUSD within allowed range
* API timestamp <= 3 hours
* native fee calculation not zero

---

