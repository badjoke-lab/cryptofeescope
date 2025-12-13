# CryptoFeeScope (Snapshot Demo)

CryptoFeeScope Phase 1 is a snapshot-based fee viewer powered by the CoinGecko Demo API. The frontend reads a static `fee_snapshot_demo.json` file (USD / JPY) and shows **one standard fee per chain**.

## What this demo includes (Phase 1)

- Snapshot-only rendering: the browser pulls `/data/fee_snapshot_demo.json` on load and every 60 seconds (no tiers, no 24h change column).
- Supported chains (standard fee only): Bitcoin (BTC), Ethereum (ETH), BNB Smart Chain (BNB), Solana (SOL), Tron (TRX), Avalanche C-Chain (AVAX), XRP Ledger (XRP), Arbitrum One (ARB), Optimism (OP).
- Mobile-friendly table layout that fits 360px width without horizontal scrolling.

## Prerequisites

- Node.js 18 or later (for built-in `fetch`).
- CoinGecko Demo API key exported as `COINGECKO_API_KEY` (set `export COINGECKO_API_KEY="<your_demo_key>"`).

## Generate the demo snapshot

Use the helper script to fetch CoinGecko Demo prices (`/api/v3/simple/price`) and emit the snapshot:

```bash
node scripts/generate_fee_snapshot_demo.js > data/fee_snapshot_demo.json
```

Deploy the updated `data/fee_snapshot_demo.json` to Cloudflare Pages (or another static host). The frontend will automatically reload the file every 60 seconds and refresh the table.
