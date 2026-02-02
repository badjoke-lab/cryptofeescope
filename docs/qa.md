# QA Checklist (Final Pre-Release)

## Meta
- Confirmed date: 2026-01-05
- Confirmed URL (prod): https://cfs.badjoke-lab.com/
- Notes: Use Chrome DevTools device toolbar for width checks.

## Optional: Screenshot Procedure
1. Open Chrome DevTools → Toggle device toolbar.
2. Set width to target size (360/390/430/768/1024+).
3. Capture with the browser’s screenshot tool or OS shortcut.

---

## A. Display widths (DevTools)
Repeat checks at **360 / 390 / 430 / 768 / Desktop(>=1024)**.

| Step | Expected result (OK criteria) |
| --- | --- |
| Open Home page at each width. | No overlap, no clipping, no forced horizontal scroll. |
| Open Stats page at each width. | No overlap, no clipping, no forced horizontal scroll. |

## B. Top (Home)
| Step | Expected result (OK criteria) |
| --- | --- |
| Enter search via `q=` (type in search box). | Results update immediately. |
| Select filter via `chains=`. | Filter reflects selection; list updates. |
| Change sort via `sort`/`dir`. | Order updates correctly. |
| Reload page with parameters in URL. | State restored from URL. |
| Use Share (copy). Open in new tab. | Same state is reproduced. |
| Scroll to bottom. | Donate CTA is at bottom and not obstructing content. |
| Check Health panel and open Details. | Health shows data and Details opens. |

## C. Stats
| Step | Expected result (OK criteria) |
| --- | --- |
| Toggle `range=24h` and `range=7d`. | Chart and numbers update correctly. |
| Use data-limited case. | `—` or “Insufficient data” shown; layout intact. |
| Verify missing points. | No interpolation; lines break where data missing. |
| Use Share (copy). Open in new tab. | Same state is reproduced. |
| Check Health panel and open Details. | Health shows data and Details opens. |

## D. Error / empty data (Task 32 final)
| Step | Expected result (OK criteria) |
| --- | --- |
| Simulate offline in DevTools; load page. | Error UI appears with retry; no infinite loading. |
| Click retry after returning online. | UI recovers to normal state. |
| Force meta fetch failure (block request). | Page remains usable; no total failure. |

## E. Link / content
| Step | Expected result (OK criteria) |
| --- | --- |
| Open Methodology link. | No 404; page loads. |
| Open main nav/footer links. | No 404 on key pages. |
| Compare labels in Top/Stats/Methodology. | Fee/Speed/Status/— are consistent. |

## F. “Light speed” checks
| Step | Expected result (OK criteria) |
| --- | --- |
| First load of Top/Stats. | Not perceived as extremely slow. |
| Change search/range. | UI remains responsive; no freezing. |
