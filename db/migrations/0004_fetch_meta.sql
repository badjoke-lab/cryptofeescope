CREATE TABLE IF NOT EXISTS fetch_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_fetch_error TEXT,
  last_fetch_error_at INTEGER,
  last_fetch_failure_key TEXT,
  last_fetch_failures TEXT,
  last_cache_used_at INTEGER,
  last_cache_age_minutes INTEGER
);
