# Fee Snapshot Schema (Phase 1)

This document summarizes the structure of `data/fee_snapshot_demo.json` for Phase 1. Future phases may extend the schema with additional fields.

## Root object

- `generatedAt` (string): ISO8601 datetime indicating when the snapshot was produced.
- `vsCurrencies` (array of strings): Fiat currency codes used in the snapshot (e.g., `["usd", "jpy"]`).
- `chains` (object): Map of chain keys to chain detail objects.

## Chain object

Each entry under `chains` uses the chain key (e.g., `btc`, `eth`) and contains:

- `label` (string): Human-readable chain name.
- `feeUSD` (number): Primary fee estimate in USD for the standard tier.
- `feeJPY` (number): Primary fee estimate in JPY for the standard tier.
- `speedSec` (number): Estimated confirmation or finality speed in seconds.
- `status` (string): Availability state such as `normal` or `unavailable`.
- `updated` (string): ISO8601 timestamp for the latest fee estimation.
- `native.amount` (number): Native asset amount assumed for the fee calculation.
- `native.symbol` (string): Native asset symbol.
- `tiers[]` (array): Fee tiers, each with `label`, `feeUSD`, and `feeJPY` values.
- `source.price.provider` (string): Price data provider identifier (e.g., `coingecko-demo`).
- `source.price.id` (string): Provider-specific asset identifier.

The schema above captures the Phase 1 fields; later phases may introduce additional properties while keeping backward compatibility where possible.
