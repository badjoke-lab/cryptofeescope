## **.agent/rules.md — CryptoFeeScope Codex Rules**

This file defines **strict, mandatory rules** for the Codex agent when working on CryptoFeeScope.
Codex MUST obey all rules in this file at all times.
If there is any conflict between files, **rules.md overrides everything.**

---

# **1. Scope of Work**

Codex is responsible for:

1. Fetching multi-source gas/gwei/sat/lamports fee data
2. Fetching multi-source fiat prices
3. Computing:

   * `feeNative`
   * `feeUSD`
   * `speedSec`
   * `status`
4. Enforcing **fiat validity ranges**
5. Generating **unit tests**
6. Producing a **clean, verified snapshot.js** and shared utilities
7. Returning ONLY correct and validated values

Codex is **not allowed** to touch UI files, styling, HTML, or unrelated directories.

---

# **2. Allowed Directories**

Codex may modify ONLY the following directories/files:

```
api/
lib/
utils/
tests/
config/
```

Codex must NOT modify:

```
public/
styles/
components/
pages/
docs/
```

UI・CSS・HTML・Next.js 部分は一切触るな。

---

# **3. Fee Calculation Requirements**

Codex MUST implement exact formulas:

### **Bitcoin**

```
feeNative = satPerVbyte * vBytes
```

### **Ethereum / EVM**

```
feeNative = gasLimit * gasPrice(ETH)
```

### **L2 (Arbitrum/Optimism/Base)**

```
feeNative = (gasLimitL2 * gasPriceL2) + (l1DataGas * l1GasPrice)
```

### **Solana**

```
feeNative = lamports / 1e9
```

### **XRP**

```
feeNative = drops / 1e6
```

Fee values MUST be precise to at least 10 decimal places.

---

# **4. Multi-source API Rules**

Codex MUST fetch **minimum 2 sources**, ideally 3–4:

## Allowed gas/fee sources

* mempool.space
* blockstream.info
* blockchair
* etherscan gas oracle
* blocknative
* alchemy / infura RPC
* ankr RPC
* avalanche official RPC
* solana `getFees`
* polygon gas station
* xrpl cluster
* arbitrum/optimism/base official RPC

## Allowed price sources

* CoinGecko
* CryptoCompare
* Binance public API

---

# **5. Freshness Requirements**

Codex MUST ensure:

* No API result older than **3 hours**
* If timestamp missing → INVALID
* If gasPrice = 0 or near 0 → INVALID
* If priceUSD = null → INVALID

Invalid values MUST trigger fallback logic.

---

# **6. Validity Range Enforcement**

Codex MUST enforce these USD ranges:

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

If `feeUSD` OUTSIDE this range:

1. Retry primary
2. Retry fallback
3. Apply **median of all valid results**
4. Set `status = "estimated"`

Codex MUST NEVER produce invalid results.

---

# **7. speedSec Rules**

Codex MUST enforce realistic speed estimates:

* BTC: based on fee tier from mempool.space
* ETH/EVM: 30 / 120 / 300 sec
* Solana: 2–6 sec
* XRP: 4 sec
* L2: 5–60 sec

---

# **8. Self-Verification**

Before completing any task, Codex MUST internally verify:

* feeNative > 0
* priceUSD != null
* feeUSD in valid range
* timestamp freshness
* output JSON schema correct

If not valid → Codex must auto-correct until valid.

---

# **9. Testing Requirements**

Codex MUST generate tests that:

* Mock API responses
* Validate correct fallback
* Validate fiat range enforcement
* Validate snapshot output shape
* Validate no null values

Tests MUST be runnable via:

```
npm test
```

---

# **10. Output Requirements**

Every Codex output MUST:

* Contain **full file content**, not patches
* Be fully formatted
* Pass unit tests
* Obey rules.md above

---

# **11. Forbidden Actions**

Codex MUST NOT:

* Modify anything outside allowed dirs
* Remove or alter these rules
* Produce UI code
* Produce incomplete code
* Produce untested code
* Ignore fiat range rules

---

# **12. Completion Condition**

Codex must continue until:

* All chains produce valid USD fees
* All tests pass
* Snapshot API returns complete, valid data
* No invalid chain remains

Codex MUST NOT conclude early.

---

**→ 以上が `.agent/rules.md` の全文。**

---

続けて

# **③ `.agent/plan.md`**

# **④ Codex 実行コマンド**

を一気に出す。
了解。
**② `.agent/rules.md`（完全版）** をそのまま貼る。
その後、③ `.agent/plan.md`、④ 修正後の Codex 実行コマンドを続けて出す。

---

# **② `.agent/rules.md`（完全版）**

以下をそのまま **`.agent/rules.md`** としてルート直下に保存しろ。

---

## **.agent/rules.md — CryptoFeeScope Codex Rules**

This file defines **strict, mandatory rules** for the Codex agent when working on CryptoFeeScope.
Codex MUST obey all rules in this file at all times.
If there is any conflict between files, **rules.md overrides everything.**

---

# **1. Scope of Work**

Codex is responsible for:

1. Fetching multi-source gas/gwei/sat/lamports fee data
2. Fetching multi-source fiat prices
3. Computing:

   * `feeNative`
   * `feeUSD`
   * `speedSec`
   * `status`
4. Enforcing **fiat validity ranges**
5. Generating **unit tests**
6. Producing a **clean, verified snapshot.js** and shared utilities
7. Returning ONLY correct and validated values

Codex is **not allowed** to touch UI files, styling, HTML, or unrelated directories.

---

# **2. Allowed Directories**

Codex may modify ONLY the following directories/files:

```
api/
lib/
utils/
tests/
config/
```

Codex must NOT modify:

```
public/
styles/
components/
pages/
docs/
```

UI・CSS・HTML・Next.js 部分は一切触るな。

---

# **3. Fee Calculation Requirements**

Codex MUST implement exact formulas:

### **Bitcoin**

```
feeNative = satPerVbyte * vBytes
```

### **Ethereum / EVM**

```
feeNative = gasLimit * gasPrice(ETH)
```

### **L2 (Arbitrum/Optimism/Base)**

```
feeNative = (gasLimitL2 * gasPriceL2) + (l1DataGas * l1GasPrice)
```

### **Solana**

```
feeNative = lamports / 1e9
```

### **XRP**

```
feeNative = drops / 1e6
```

Fee values MUST be precise to at least 10 decimal places.

---

# **4. Multi-source API Rules**

Codex MUST fetch **minimum 2 sources**, ideally 3–4:

## Allowed gas/fee sources

* mempool.space
* blockstream.info
* blockchair
* etherscan gas oracle
* blocknative
* alchemy / infura RPC
* ankr RPC
* avalanche official RPC
* solana `getFees`
* polygon gas station
* xrpl cluster
* arbitrum/optimism/base official RPC

## Allowed price sources

* CoinGecko
* CryptoCompare
* Binance public API

---

# **5. Freshness Requirements**

Codex MUST ensure:

* No API result older than **3 hours**
* If timestamp missing → INVALID
* If gasPrice = 0 or near 0 → INVALID
* If priceUSD = null → INVALID

Invalid values MUST trigger fallback logic.

---

# **6. Validity Range Enforcement**

Codex MUST enforce these USD ranges:

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

If `feeUSD` OUTSIDE this range:

1. Retry primary
2. Retry fallback
3. Apply **median of all valid results**
4. Set `status = "estimated"`

Codex MUST NEVER produce invalid results.

---

# **7. speedSec Rules**

Codex MUST enforce realistic speed estimates:

* BTC: based on fee tier from mempool.space
* ETH/EVM: 30 / 120 / 300 sec
* Solana: 2–6 sec
* XRP: 4 sec
* L2: 5–60 sec

---

# **8. Self-Verification**

Before completing any task, Codex MUST internally verify:

* feeNative > 0
* priceUSD != null
* feeUSD in valid range
* timestamp freshness
* output JSON schema correct

If not valid → Codex must auto-correct until valid.

---

# **9. Testing Requirements**

Codex MUST generate tests that:

* Mock API responses
* Validate correct fallback
* Validate fiat range enforcement
* Validate snapshot output shape
* Validate no null values

Tests MUST be runnable via:

```
npm test
```

---

# **10. Output Requirements**

Every Codex output MUST:

* Contain **full file content**, not patches
* Be fully formatted
* Pass unit tests
* Obey rules.md above

---

# **11. Forbidden Actions**

Codex MUST NOT:

* Modify anything outside allowed dirs
* Remove or alter these rules
* Produce UI code
* Produce incomplete code
* Produce untested code
* Ignore fiat range rules

---

# **12. Completion Condition**

Codex must continue until:

* All chains produce valid USD fees
* All tests pass
* Snapshot API returns complete, valid data
* No invalid chain remains

Codex MUST NOT conclude early.

---
