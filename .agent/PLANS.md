# PLANS.md — CryptoFeeScope v1 Fix Plan

This plan defines the exact implementation order for CryptoFeeScope v1 compliance.
Follow this plan strictly. Do not skip steps.

---

## Phase 0 — Read & Lock Spec
- Read `AGENTS.md` and the v1 Final Spec summary inside it.
- Treat spec as the only source of truth.

Deliverable:
- None (internal).

---

## Phase 1 — Fatal Fixes (must complete first)

### 1.1 Fix DOM ID alignment in app.js
- Replace all old DOM lookups with Final Spec IDs:
````

status, refreshBtn, themeBtn, priority, fiat, q, tbody, feeHeader,
detailsTooltip, historyChain, historyCanvas

```
- Remove every reference to:
`statusText, updatedText, searchInput, prioritySelect, fiatSelect,
 mainTbody, historyChainSelect, historyEmpty, historyTitle, historyCard`

Deliverable:
- Updated `app.js` (DOM section correct).

---

### 1.2 Convert /api/snapshot to `chains` format
- Replace root-level keys (bitcoin/ethereum/solana/...) with:
```

chains: { btc, eth, sol, arb, op, base, polygon, bsc }
generatedAt

````
- Ensure always-200 behavior.
- Ensure placeholders for failures:
`ok:false, status:"failed", feeUSD:null, feeJPY:null, speedSec:null`

Deliverable:
- Updated `api/snapshot.js` returning exact v1 shape.

---

### 1.3 Expand snapshot.js to 8 chains
- Add **base / polygon / bsc** using Etherscan-compatible gas oracle endpoints.
- Reuse the single Etherscan API key.
- Keep the same calculation approach as ETH/ARB/OP.

Deliverable:
- `api/snapshot.js` supports all 8 chains.

---

### 1.4 Shrink CHAINS list in app.js to v1 fixed 8
- Remove old 20+ chain list.
- Render only in this order:
`btc, eth, sol, arb, op, base, polygon, bsc`

Deliverable:
- `app.js` renders exactly 8 rows.

---

## Phase 2 — Important Fixes (v1 DoD)

### 2.1 Details 4-line fixed rendering
- Replace variable tiers rendering with exact 4 lines:
1. Exact fee
2. Fast (~sec)
3. Normal (~sec)
4. Slow (~min)
- No toggle-close. Outside-click close only.

Deliverable:
- Updated Details renderer in `app.js`.

---

### 2.2 Restore rowglow animation
- After each refresh (manual or auto):
- Add `rowglow` + `on` to all `<tr>`
- Remove `on` after 400–700ms
- Only JS changes unless CSS missing.

Deliverable:
- Working glow on refresh.

---

### 2.3 Wire themeBtn toggle
- On click of `themeBtn`:
- Toggle `body.dark`
- Persist to localStorage
- Restore on load.

Deliverable:
- Working theme toggle.

---

### 2.4 Fix footer flex layout if needed
- Ensure:
```css
body{display:flex;flex-direction:column;min-height:100vh;}
main{flex:1 0 auto;}
footer{flex-shrink:0;}
````

* Adjust only if footer floats or extra scroll remains.

Deliverable:

* Footer always at bottom.

---

## Phase 3 — Low Priority / Preview (optional for v1)

### 3.1 Update history.js to read chains shape

* Accept new snapshot / chains format.
* Return points safely even if empty.

Deliverable:

* Stable preview history (no UI break).

### 3.2 Update push-history.js to chains shape

* Only if it currently breaks preview.

Deliverable:

* Compatible preview pipeline.

---

## Phase 4 — Cleanup (last)

* Remove from final tree:
  `.git/ .vercel/ _old/ __MACOSX/ .DS_Store`
* Do not delete env/config required for deployment.

Deliverable:

* Clean v1 repo layout.

---

## Definition of Done (v1)

* 8 chains render correctly with real values when available.
* Refresh + 60s auto-update works.
* Details 4-line fixed format works.
* Fee cells do nothing on click.
* rowglow works.
* Theme toggle works.
* Footer does not float.
* Mobile not optimized but not broken.
* API always returns 200 with per-chain ok/status fields.

Stop when DoD is satisfied.


