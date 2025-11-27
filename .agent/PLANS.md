# CryptoFeeScope v2 — Codex Implementation Plan

## Phase 1 — Setup

1. Load current repository
2. Identify fee logic files
3. Prepare new folder `/logic/fee-v2`
4. Import fetch libs + retry logic

## Phase 2 — API Layer

* Implement multi-source gasPrice fetchers
* Implement multi-source fiat price fetchers
* Implement timestamp checks
* Implement median aggregator

## Phase 3 — Fee Models

* BTC vBytes × sat
* ETH/EVM gas×price
* L2 models
* Solana lamports
* XRP drops
* Polygon/Avalanche proper gas scaling

## Phase 4 — USD Validation Layer

* Apply minUSD / maxUSD
* Implement outlier filter
* Implement retry + fallback logic

## Phase 5 — Chain Output Builder

* Produce final snapshot object
* Ensure correctness

## Phase 6 — Unit Tests

* timestamp freshness
* price not null
* feeUSD within range
* speedSec existence

## Phase 7 — Replace old logic

* Overwrite `/api/snapshot.js` with v2
* Keep backwards compatibility

---

