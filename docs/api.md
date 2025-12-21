# API reference (Pages Functions)

These endpoints are served from Cloudflare Pages Functions and read fee data from the D1 table `fee_history_points`. Data is estimated and for comparison only.

## Supported parameters

- **Chains:** `btc`, `eth`, `bsc`, `sol`, `tron`, `avax`, `xrp`, `arbitrum`, `optimism`
- **Ranges:** `1h`, `6h`, `24h`, `7d`, `30d` (default: `24h`)

## `GET /api/history`

Returns time-series points for a single chain within the requested range.

Query parameters:

- `chain` (required): chain id from the list above
- `range` (optional): one of the ranges above
- `limit` (optional): positive integer, capped at 2000

Example:

```bash
curl "https://<your-pages-domain>/api/history?chain=eth&range=24h"
```

Response shape:

```json
{
  "chain": "eth",
  "range": "24h",
  "fromTs": 1700000000,
  "toTs": 1700086400,
  "count": 100,
  "points": [
    {"ts": 1700000000, "feeUsd": 0.12, "feeJpy": 18.3, "speedSec": 12, "status": "fast"}
  ]
}
```

## `GET /api/stats`

Returns aggregated statistics per chain within the requested range. Optionally filter to a single chain.

Query parameters:

- `range` (optional): one of the ranges above
- `chain` (optional): chain id from the list above

Example:

```bash
curl "https://<your-pages-domain>/api/stats?range=7d"
```

Response shape:

```json
{
  "range": "24h",
  "fromTs": 1700000000,
  "toTs": 1700086400,
  "chains": [
    {
      "chain": "eth",
      "count": 144,
      "firstTs": 1700000000,
      "lastTs": 1700086400,
      "feeUsd": {"avg": 0.12, "min": 0.08, "max": 0.22},
      "speedSec": {"avg": 12, "min": 10, "max": 20}
    }
  ]
}
```
