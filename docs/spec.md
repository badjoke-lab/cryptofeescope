## spec.md — CryptoFeeScope v2 Fee Logic Rebuild Specification (for Codex)

### 🎯 Objective

Rebuild the **fee estimation engine** for CryptoFeeScope (v2) with:

- More robust, API-driven fee estimation
- Valid USD/JPY ranges per chain
- Timestamp freshness checks
- Fallback / retry logic
- Deterministic tests

> **Important:**  
> This spec describes the **v2 “engine”**.  
> The current public MVP (Phase 1 / Phase 1.5) may still use a simpler
> snapshot pipeline (CoinGecko-only, static JSON).  
> Codex must treat this document as the **target design for the next
> major engine upgrade**, not the current production behavior.

---

## 0. Scope & Versioning

- **Scope:** internal fee calculation engine used to produce per-chain fee data.
- **Out of scope (for this file):**
  - Frontend UI details
  - Cloudflare Worker common API envelope (`/v1/fees/current`)
  - Snapshot aggregation format (see separate `fee_snapshot_schema.md`)

Relationship to other docs:

- This spec defines the **low-level fee result per chain**.
- A separate spec (Phase 1 / snapshot spec) defines how multiple chains are
  aggregated into one JSON document consumed by the frontend.

---

## 1. Supported Chains (v2 target set)

The v2 engine **must at least** support:

- Bitcoin (BTC)
- Ethereum (ETH, mainnet)
- BNB Smart Chain (BSC)
- Polygon PoS (MATIC)
- Avalanche C-Chain (AVAX)
- Solana (SOL)
- XRP Ledger (XRP)
- Tron (TRX)
- Arbitrum One (L2, gas = ETH)
- Optimism (L2, gas = ETH)
- Base (L2, gas = ETH)

> Note: Additional chains (e.g. Sei, Mantle, Blast, etc.) can be added later
> using the same patterns. This spec focuses on the **core 10+1 chains**.

---

## 2. Data Sources (Gas / Fee Inputs)

### 2.1 Multi-source principle

Where possible, each chain should use **2–4 independent data sources**
for gas/fee metrics (RPCs, explorers, dedicated gas APIs).

However、現実的な制約を考慮してルールを緩和する：

- **MUST:** at least **one reliable source** per chain
  (official RPC or widely-used explorer API).
- **SHOULD:** use **2+ sources** when a reasonable free tier or simple setup exists.
- **MAY:** fall back to a single source for less important chains, as long as
  fee results stay within the USD validity ranges.

Examples (non-binding):

- **Bitcoin:** mempool.space / blockstream / blockchair
- **Ethereum / EVM:** Etherscan Gas API / public RPC / other gas trackers
- **Solana:** `getFees` RPC
- **XRP:** public XRPL nodes (`server_info`, `fee`)
- **L2s:** Alchemy / Infura / explorers that expose L2 gas data

### 2.2 Freshness & sanity rules

For each data point:

- Attach a timestamp.
- Reject values older than **3 hours**.
- Reject zero or near-zero gasPrice (EVM).
- Reject obviously broken values (negative, NaN).

When multiple sources exist:

- Use **median** or other robust aggregation
  to avoid single-source outliers.

---

## 3. Native Fee Calculation

Codex must implement chain-specific native fee formulas.

### 3.1 Bitcoin

```ts
feeNative = vBytes * satPerVbyte; // in BTC
````

* `vBytes`: estimated transaction virtual size
* `satPerVbyte`: chosen fee tier (e.g. “fast” or “normal”)

### 3.2 Ethereum / EVM (ETH, BSC, Polygon, Avalanche etc.)

```ts
feeNative = gasLimit * gasPrice; // both in ETH-equivalent units
```

* `gasPrice` in ETH (or chain-native) units, not gwei.
* For EIP-1559 chains, base/priority fee may be combined
  into an effective `gasPrice`.

### 3.3 L2 (Arbitrum / Optimism / Base)

```ts
feeNative =
  (L2GasLimit * L2GasPrice) +
  (L1DataGas * L1GasPrice);
```

* If precise L1 data cost is not easily available on free tiers,
  Codex may use **documented approximations** or heuristic constants,
  as long as final `feeUSD` stays within the validity ranges.

### 3.4 Solana

```ts
feeNative = lamports / 1e9; // SOL
```

### 3.5 XRP Ledger

```ts
feeNative = drops / 1e6; // XRP
```

### 3.6 Tron

* Use an energy/bandwidth model appropriate for a typical TRX transfer
  or TRC-20 transfer.
* The exact formula may depend on free tier APIs, but the end result
  must satisfy the USD validity constraints.

---

## 4. Fiat Conversion (USD / JPY)

### 4.1 Price sources

Fiat conversion must use at least **one** external price API,
with others as optional fallbacks.

* **Primary:** CoinGecko (Demo / Free / Pro)
* **Optional fallbacks (when keys/limits allow):**

  * CryptoCompare
  * Binance API (ticker price)

### 4.2 Conversion rules

For each chain:

```ts
feeUSD = feeNative * priceUSD;
feeJPY = feeNative * priceJPY; // when available
```

Rules:

* `priceUSD` **must not** be null or NaN.
* If `priceUSD` cannot be retrieved from the primary source:

  * Try fallbacks (if configured).
  * If all fail → mark the chain as `"status": "estimated"` and either:

    * use last-known valid price within a short TTL (e.g. 1–6 hours), or
    * skip this chain from the snapshot (depending on config).

> Note: For v2, multi-fiat support (USD + JPY) is **expected**, but additional
> currencies can be added later. The snapshot builder will decide which
> `vsCurrencies` are included in the final JSON.

---

## 5. USD Validity Ranges

For sanity checks, Codex must enforce approximate USD ranges
for “typical transfer” fees:

| Chain     | minUSD   | maxUSD |
| --------- | -------- | ------ |
| BTC       | 0.02     | 100    |
| ETH       | 0.02     | 20     |
| BSC       | 0.01     | 2      |
| Polygon   | 0.001    | 1      |
| Avalanche | 0.002    | 1      |
| Solana    | 0.0001   | 0.02   |
| XRP       | 0.000001 | 0.05   |
| Tron      | 0.0005   | 0.5    |
| Arbitrum  | 0.003    | 0.5    |
| Optimism  | 0.003    | 0.5    |
| Base      | 0.003    | 0.5    |

Behavior:

1. Compute `feeUSD`.
2. If `feeUSD` is outside `[minUSD, maxUSD]`:

   * Retry gas/fee API once.
   * Try price fallback (if configured).
   * Recalculate.
3. If still invalid:

   * Use **safe median** of fallback results (if multiple exist), or
   * Clamp into `[minUSD, maxUSD]` and set `"status": "estimated"`.

`feeUSD` **must not remain invalid / NaN** in any final output.

---

## 6. Transaction Speed (speedSec)

Codex must estimate **typical confirmation or inclusion time**
for the chosen fee tier:

* **BTC:** based on mempool fee tiers

  * e.g. fast = 10–20min, normal = 30–60min
* **ETH/EVM:**

  * fast ≈ 30s
  * normal ≈ 2min
  * slow ≈ 5min
* **L2 (Arbitrum / Optimism / Base):**

  * typically 5–60s for inclusion
* **Solana:** 2–6s
* **XRP:** ~4s
* **Tron:** typically <60s

Accuracy within **±30%** is acceptable.
If exact modeling is hard, use a fixed heuristic per status tier.

---

## 7. Output Schema (Per-chain Fee Result)

The v2 engine must output a **per-chain fee result** in the following shape:

```ts
type FeeStatus = "ok" | "estimated" | "unavailable";

interface ChainFeeResult {
  chain: string;        // e.g. "bitcoin", "ethereum"
  network: string;      // e.g. "mainnet", "bsc", "polygon-pos"
  symbol: string;       // e.g. "BTC", "ETH"
  feeNative: number;    // chain-native units
  feeUSD: number;       // converted using current price
  feeJPY?: number;      // optional but preferred
  speedSec: number;     // estimated time to confirm
  status: FeeStatus;    // "ok" or "estimated" (or "unavailable")
  updated: string;      // ISO8601 timestamp
}
```

> **Important:**
> This is the **low-level engine output**.
> A separate snapshot builder will aggregate multiple
> `ChainFeeResult` objects into the app-level snapshot JSON
> consumed by the frontend (see `fee_snapshot_schema.md`).

---

## 8. Tests (Required)

Codex must generate deterministic tests for the v2 engine:

* For each supported chain:

  * `priceUSD` is not null or NaN.
  * `feeUSD` is within the chain’s validity range (or status becomes `"estimated"`).
  * `feeNative` is not zero or NaN.
  * `updated` is a fresh timestamp (within e.g. 3h).
* For the snapshot builder:

  * Aggregation produces a valid object shape
    (compatible with the snapshot spec).
  * No chain in the final output has invalid `feeUSD`.

Testing strategy can include:

* Mocked API responses for gas/fee sources.
* Mocked price API responses.
* Boundary cases around min/max USD ranges.

---
