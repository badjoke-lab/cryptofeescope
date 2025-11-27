## **.agent/plan.md — CryptoFeeScope Fee Logic Rebuild Execution Plan**

This document tells Codex **exactly what steps to perform, in exact order.**
Codex MUST NOT change the order unless explicitly instructed by `rules.md`.

---

# **0. Initial State**

* All code is in the provided repository.
* `spec.md` and `.agent/rules.md` define the full requirements.
* Codex must implement the entire backend fee engine from scratch if needed.
* Codex must NOT modify UI.

---

# **1. Create New Internal Structure**

Codex MUST generate the following structure if missing:

```
config/
  chains.js
  ranges.js

lib/
  fetchGas/
    btc.js
    evm.js
    l2.js
    solana.js
    xrp.js
  fetchPrice/
    price.js
  calc/
    calcFee.js
    calcSpeed.js
  validate/
    validateFee.js
    schema.js
  utils/
    http.js
    median.js

tests/
  fee.test.js
  price.test.js
  snapshot.test.js
```

All logic MUST be split by chain type (BTC/EVM/L2/etc).

---

# **2. Implement Multi-Source Gas Fetchers**

Codex MUST implement each file:

### **Bitcoin**

Sources (min 2 required):

* mempool.space
* blockstream.info
* blockchair

Gather:

```
satPerVbyte
vBytes = 140 (fixed)
timestamp
```

---

### **EVM (ETH / BSC / Polygon / Avalanche)**

Sources (min 2 required):

* Etherscan gas oracle
* Blocknative
* Ankr RPC
* Alchemy/Infura RPC

Gather:

```
gasPrice (in gwei)
gasLimit = 65,000 (token transfer)
timestamp
```

Reject:

* gasPrice <= 0.01 gwei
* old timestamps (>3h)

---

### **L2 (Arbitrum / Optimism / Base)**

Gather:

```
L2 gasPrice(gwei)
L2 gasLimit = 65,000
L1 data gas (use estimates)
L1 gasPrice (from ETH)
timestamp
```

Sources:

* chain-specific RPC
* L2Scan API (if available)
* etherscan-l2

---

### **Solana**

From RPC:

```
getFees
lamports
```

---

### **XRP**

From XRPL cluster:

```
drops (base fee)
```

---

# **3. Implement Price Fetchers**

File: `lib/fetchPrice/price.js`

Codex MUST fetch from:

1. **CoinGecko**
2. **CryptoCompare**
3. **Binance** (fallback)

Take **median** of valid values.

Reject:

* null
* zero
* out-of-date (>3h)

---

# **4. Implement Fee Calculation**

File: `lib/calc/calcFee.js`

Codex MUST implement formulas:

### BTC

```
feeNative = satPerVbyte * vBytes / 1e8
```

### EVM

```
feeNative = gasLimit * gasPriceInETH
```

### L2

```
feeNative = (L2GasLimit * L2GasPrice) + (L1DataGas * L1GasPrice)
```

### Solana

```
feeNative = lamports / 1e9
```

### XRP

```
feeNative = drops / 1e6
```

---

# **5. Fiat Conversion**

```
feeUSD = feeNative * priceUSD
```

If out of validity range → apply fallback.

---

# **6. Validate Results**

File: `lib/validate/validateFee.js`

Codex MUST check:

* feeNative > 0
* priceUSD != null
* feeUSD within allowed range (config/ranges.js)
* timestamp freshness
* JSON shape

If invalid:

* Retry secondary API
* Use median from alternatives
* Mark status = "estimated"

---

# **7. Implement speedSec Calculation**

File: `lib/calc/calcSpeed.js`

Rules:

* BTC: map sat/vByte tier → speed
* ETH: fast/normal/slow fixed
* L2: 5–60 sec
* Solana: 2–6 sec
* XRP: 4 sec

---

# **8. Build Final Snapshot**

File: `api/snapshot.js`

Codex MUST:

* Fetch all chain fees in parallel
* Validate each
* Convert to USD
* Output unified JSON
* No null values
* Attach updated timestamp

---

# **9. Build Full Unit Tests**

Codex MUST generate:

### `tests/fee.test.js`

* Validate feeNative for each chain
* Validate fallback logic

### `tests/price.test.js`

* Mock API and ensure median price fetch works

### `tests/snapshot.test.js`

* Ensure snapshot returns correct schema
* Ensure no invalid values

Tests MUST run via：

```
npm test
```

---

# **10. Completion Criteria**

Codex MUST NOT stop until:

* All chains return valid USD fees
* All USD fees within allowed ranges
* No null values
* All tests pass
* snapshot.js produces correct output

---

**→ 以上が `.agent/plan.md` の全文。**

---

# **④ Codex 実行コマンド（最終版）**

これを **GitHub の root に置いた状態で** Codex に投げれば即実行に入る。

---

## **Codex 実行コマンド**

```
You are Codex.
Follow all rules in .agent/rules.md and the spec in spec.md.
Follow the exact execution plan in .agent/plan.md.
Start implementing now.

Your job:
- Rebuild the entire fee engine
- Implement all files listed in the plan
- Produce full file contents (not patches)
- Add complete tests
- Ensure all feesUSD fall within allowed ranges
- Ensure no null or invalid values
- Continue until snapshot.js is fully correct and all tests pass

Begin with step 1 from .agent/plan.md.
```

---
