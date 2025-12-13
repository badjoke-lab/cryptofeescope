# Fee Snapshot Schema (Phase 1)

Phase 1 delivers a static snapshot that lists a single standard fee per chain. There are no tiers or price-change metrics in this version.

## Top-level fields

- `generatedAt` (`string`): ISO8601 timestamp when the snapshot was generated.
- `vsCurrencies` (`string[]`): Fiat currencies included in the snapshot. Phase 1 uses `["usd", "jpy"]`.
- `chains` (`object`): Map keyed by chain id (e.g., `btc`, `eth`). Each value describes one chain entry.

## Chain entry fields

- `label` (`string`): Human-readable chain name.
- `feeUSD` (`number | null`): Standard transfer fee converted to USD. `null` if pricing is unavailable.
- `feeJPY` (`number | null`): Standard transfer fee converted to JPY. `null` if pricing is unavailable.
- `speedSec` (`number | null`): Estimated confirmation time in seconds for a standard transaction.
- `status` (`string`): Display hint for speed/availability (e.g., `fast`, `normal`, `slow`, `unavailable`).
- `updated` (`string | null`): ISO8601 timestamp for the entry. Aligns with `generatedAt` in the demo generator.
- `native.amount` (`number`): Native fee amount (before fiat conversion).
- `native.symbol` (`string`): Native token symbol for the chain.
- `source.price.provider` (`string`): Price provider identifier (e.g., `coingecko-demo`).
- `source.price.id` (`string`): Provider-specific asset id used for price lookup.

## Notes

- Phase 1 ships **single standard fee only**; tiered fees are not produced or rendered yet.
- The snapshot is static. The frontend simply refetches the JSON periodically (every 60 seconds) instead of streaming updates.
