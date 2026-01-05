ALTER TABLE fetch_meta ADD COLUMN last_run_invalid_count INTEGER;
ALTER TABLE fetch_meta ADD COLUMN last_run_invalid_chains TEXT;
ALTER TABLE fetch_meta ADD COLUMN last_run_warning_chains TEXT;
