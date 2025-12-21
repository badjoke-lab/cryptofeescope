# History Writer Worker

A Cloudflare Scheduled Worker that fetches the latest fee snapshot JSON and writes one history point per chain into the `fee_history_points` D1 table. It runs every 10 minutes and uses idempotent inserts keyed by `(chain, ts)`.

## Configuration

Bindings and variables are defined in `wrangler.toml`:

- **D1 Binding**: `DB` (points to your `cryptofeescope` D1 database)
- **Environment variable**: `SNAPSHOT_URL` (defaults to `https://cryptofeescope.pages.dev/data/fee_snapshot_demo.json`)
- **Cron trigger**: `*/10 * * * *`

Update `database_id` in `wrangler.toml` to match your Cloudflare D1 database.

## Deployment

```bash
cd workers/history-writer
wrangler deploy
```

## Notes

- The Worker only runs on its scheduled trigger. For local iteration, `wrangler dev --test-scheduled` can be used to execute the scheduled handler manually.
- No UI or GitHub Actions changes are needed for this Worker.
- After deployment in Cloudflare, create or select your D1 database, bind it as `DB`, and confirm the 10-minute cron trigger is enabled.
