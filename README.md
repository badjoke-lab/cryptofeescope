# CryptoFeeScope (Snapshot Demo)

This repository includes a minimal demo snapshot for fee visualization. The demo snapshot can be regenerated locally with a small Node.js helper.

## Prerequisites

- Node.js 18 or later (for built-in `fetch`)
- CoinGecko Demo API key exported as `COINGECKO_API_KEY`

## Generate the demo snapshot

Use the helper script to fetch CoinGecko Demo prices (`/api/v3/simple/price`) and emit a snapshot compatible with `data/fee_snapshot_demo.json`:

```bash
node scripts/generate_fee_snapshot_demo.js > data/fee_snapshot_demo.json
```

The script prints JSON to standard output so you can redirect it to the snapshot file or another destination as needed.
