## **spec.md — CryptoFeeScope v2 Fee Logic Rebuild Specification (for Codex)**

### 🎯 **Objective**

Rebuild the **entire fee estimation system** for CryptoFeeScope using:

* **Real-time multi-source API aggregation**
* **Strict fiat (USD) validity-range enforcement**
* **Timestamp freshness checks**
* **Automatic fallback / retry logic**
* **Deterministic unit tests**

The **ONLY requirement** for correctness is:

> **Final `feeUSD` MUST be within realistic chain ranges.**
> Middle values (gas price, gas limit, sat/vB, lamports, etc.) are irrelevant unless they produce correct final USD fees.

---

## **Supported Chains**

* Bitcoin
* Ethereum
* BNB Smart Chain (BSC)
* Polygon PoS
* Avalanche C-Chain
* Solana
* XRP Ledger
* Arbitrum
* Optimism
* Base

---

## **Core Requirements**

### **1. Multi-source Gas/Fee API Fetch**

Each chain must use **2–4 independent data sources**, such as:

* Bitcoin: mempool.space / blockstream / blockchair
* Ethereum/EVM: Etherscan Gas API / Blocknative / public RPC / Ankr
* Solana: `getFees` RPC
* XRP: XRPL ledger API
* L2s: alchemy / infura / etherscan-l2 endpoints

Rules:

* Attach timestamp to each fetched value
* Reject values older than **3 hours**
* Reject zero or near-zero gasPrice (EVM)
* Reject extreme outliers using **median**

---

### **2. Native Fee Calculation**

Codex must implement correct chain-specific fee formulas:

#### Bitcoin

```
feeNative = vBytes * satPerVbyte
```

#### Ethereum / EVM

```
feeNative = gasLimit * gasPrice (in ETH)
```

#### L2 (Arbitrum / Optimism / Base)

```
feeNative = (L2GasLimit * L2GasPrice) + (L1DataGas * L1GasPrice)
```

#### Solana

```
feeNative = lamports / 1e9
```

#### XRP

```
feeNative = drops / 1e6
```

---

### **3. Fiat Conversion**

```
feeUSD = feeNative * priceUSD
```

Fiat price must come from:

* CoinGecko
* CryptoCompare
* Binance API (fallback)

Rules:

* Must retry on failure
* Null forbidden
* Must produce consistent output

---

### **4. USD Validity Ranges**

The system must enforce:

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

---

### **5. Outlier Filter Rules**

If `feeUSD` is outside its allowed range:

1. Retry API
2. Use fallback providers
3. Recalculate
4. If still invalid →

   * Use **safe median** of fallback results
   * Set `"status": "estimated"`

`feeUSD` **must never remain invalid**.

---

### **6. Transaction Speed (speedSec)**

Codex must implement realistic estimates:

* **BTC**: based on mempool fee tiers
* **ETH/EVM**: 30s / 2m / 5m
* **L2**: 5–60s finality
* **Solana**: 2–6s
* **XRP**: ~4s

Accuracy within ±30% is acceptable.

---

### **7. Output Schema**

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

---

### **8. Tests (Required)**

Codex must generate full unit tests verifying:

* priceUSD ≠ null
* feeUSD within allowed range
* timestamp freshness
* native fee not zero
* snapshot endpoint returns valid shape

---
