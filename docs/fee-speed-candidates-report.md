# Fee + Speed Candidate Report

## Chains

- **btc**: primary model derived from mempool.space sat/vB recommendations multiplied by typical vbyte sizes (140–400). Candidates with missing or zero sats marked invalid. TODO: add additional explorer fallback if mempool API unreachable.
- **eth/bsc/polygon/avax**: legacy gasPrice and EIP-1559 (baseFee + priorityFee) models using 21k/65k gas limits. Native values chosen even when USD price unavailable. TODO: add explorer oracle as backup for RPC outages.
- **arb/op/base**: synthetic L2 fee models with and without estimated L1 data cost (16k/20k gas using Ethereum gasPrice). TODO: integrate official fee endpoints where available and add calldata compression hints.
- **sol**: RPC prioritization fee plus base lamports per signature. TODO: fallback to public explorer averages when RPC unavailable.
- **xrp**: rippled `fee` base drops converted to XRP. TODO: add xrpscan fallback and dynamic multiplier for network load.

## Rejected models

- Candidates returning null/NaN/negative/zero are flagged invalid with `reasonIfInvalid`. Zero-fee placeholders removed when any positive candidate exists.
- Price lookups that fail no longer set feeUSD; `priceUnavailable` is surfaced instead of forcing 0.

## Known gaps

- Additional speed sources per chain are needed for robustness (currently block interval heuristics for some networks).
- L2 data cost estimates rely on Ethereum gasPrice; consider chain-specific data pricing APIs.
