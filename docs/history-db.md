# Fee history database

The `fee_history_points` table stores one row per chain and snapshot timestamp, using UTC seconds in the `ts` column. Values for `fee_usd`, `fee_jpy`, and `speed_sec` may be null when data is missing, while `status` captures a simple state like `fast`, `normal`, `slow`, `unknown`, or `error`. The `source` column defaults to `demo_snapshot` so we can distinguish demo data from future live feeds, and `model` can optionally capture the methodology identifier used.

Snapshot writes should append a new row for each chain roughly every 10 minutes. Queries typically select the most recent 24 hours or 7 days for a single chain using the `(chain, ts)` primary key and supporting indexes to filter efficiently. Duplicate rows for the same chain and timestamp are prevented by the primary key. A retention helper (e.g., pruning older than 7 days) can be added in a later migration if needed.
