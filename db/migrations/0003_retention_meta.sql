CREATE TABLE IF NOT EXISTS retention_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention_days INTEGER NOT NULL,
  last_prune_at INTEGER,
  last_prune_deleted INTEGER,
  last_prune_ok INTEGER,
  last_prune_error TEXT
);
