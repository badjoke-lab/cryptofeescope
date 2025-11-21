# AGENTS.md — CryptoFeeScope (v1)

You are Codex working on CryptoFeeScope.
Your job is to modify existing code to match the **CryptoFeeScope v1 Final Spec** provided by the owner.

## 0. Project Scope
- Project: CryptoFeeScope
- Target version: v1.0 (Final)
- Goal: Fix current phase4 code to exactly match v1 Final Spec.
- Focus: correctness, stability, and internal consistency.

## 1. Absolute Rules (MUST)
1. **Do NOT redesign UI.**
   - Only minimal edits required for spec compliance.
2. **Do NOT touch mobile optimization.**
   - Mobile UX improvements are v1.1. Leave current mobile layout as-is unless it is a fatal break.
3. **Do NOT add click/tap behavior to Fee cells.**
   - Fee cells must remain display-only.
4. **Details behavior must NOT toggle closed.**
   - Clicking Details only re-renders the same info below the button.
   - Closing is only by outside click.
5. **API must always return HTTP 200.**
   - Chain-level failures are handled per-chain with ok:false + status:"failed".
6. **No new dependencies.**
   - Use existing vanilla JS / current structure only.
7. Keep changes localized to required files only.

## 2. Files You Are Allowed to Modify
**Required (Fatal/Important):**
- `app.js`
- `api/snapshot.js`
- `index.html` (only if needed for ID alignment / footer hierarchy)
- `style.css` (only if needed for tiers layout / footer flex)

**Low priority / preview (only if spec requires):**
- `api/history.js`
- `api/push-history.js`

## 3. Files You Must NOT Touch
- Any `_old/` directory contents
- `.git/`, `.vercel/`, `__MACOSX/`, `.DS_Store`
- Static pages unless explicitly required by spec:
  - `about.html`, `donate.html`, `data-sources.html`, `disclaimer.html`, `stats.html`

## 4. v1 Final Spec Summary (Source of Truth)
### Chains (v1 fixed 8)
Order and IDs:
```

btc, eth, sol, arb, op, base, polygon, bsc

```

### DOM IDs (must match index.html)
```

status
refreshBtn
themeBtn
priority
fiat
q
tbody
feeHeader
detailsTooltip
historyChain
historyCanvas

````

### /api/snapshot response shape
```json
{
  "generatedAt": "ISO8601",
  "chains": {
    "btc": {...},
    "eth": {...},
    "sol": {...},
    "arb": {...},
    "op": {...},
    "base": {...},
    "polygon": {...},
    "bsc": {...}
  }
}
````

Each chain:

```json
{
  "feeUSD": number|null,
  "feeJPY": number|null,
  "speedSec": number|null,
  "status": "fast"|"avg"|"slow"|"failed",
  "updated": "ISO8601",
  "tiers": [
    {"label":"standard","feeUSD":number,"speedSec":number},
    {"label":"fast","feeUSD":number,"speedSec":number},
    {"label":"slow","feeUSD":number,"speedSec":number}
  ],
  "ok": boolean
}
```

* Always return 200.
* Always include 8 chain keys even on failure.

### Details (fixed 4-line)

When Details button clicked, show EXACT 4 lines under button:

1. Exact fee
2. Fast (~sec)
3. Normal (~sec)
4. Slow (~min)

### rowglow

After each successful refresh, all rows glow briefly (JS adds `rowglow` + `on`, then removes `on`).

## 5. Output Requirements

When done, output:

1. Full updated `app.js`
2. Full updated `api/snapshot.js`
3. If edited: full updated `index.html` and/or `style.css`
4. A short bullet list of what changed and why.

Nothing else.
