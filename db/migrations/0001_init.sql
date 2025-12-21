CREATE TABLE IF NOT EXISTS fee_history_points (
  ts INTEGER NOT NULL,
  chain TEXT NOT NULL,
  fee_usd REAL,
  fee_jpy REAL,
  speed_sec INTEGER,
  status TEXT,
  source TEXT NOT NULL DEFAULT 'demo_snapshot',
  model TEXT,
  PRIMARY KEY (chain, ts)
);

CREATE INDEX IF NOT EXISTS idx_fee_history_ts
  ON fee_history_points (ts);

CREATE INDEX IF NOT EXISTS idx_fee_history_chain_ts
  ON fee_history_points (chain, ts);
