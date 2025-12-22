-- Ensure efficient lookups by chain and time range for fee history queries.
CREATE INDEX IF NOT EXISTS idx_fee_history_chain_ts_desc
  ON fee_history_points (chain, ts DESC);
