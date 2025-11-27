# CryptoFeeScope Codex Agent Rules

## 🎯 Purpose

This agent rebuilds the entire fee estimation logic and ensures feeUSD correctness using real-time data.

## 🟥 Hard Prohibitions

* No mock data
* No invented API responses
* No outdated articles (> 3 days old)
* No guessing of fee ranges (must use spec values)
* No UI changes
* No rewriting unrelated parts of the repository

## 🟦 Must Follow

* Read spec.md
* Follow plan.md sequentially
* Generate correct TypeScript/JavaScript code
* Implement auto-fallback and multi-API aggregation
* Produce deterministic unit tests
* Never leave feeUSD null
* Never output values outside allowed ranges

---

