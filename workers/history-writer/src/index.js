import { validateSnapshot } from "./validateSnapshot.mjs";

const DEFAULT_SNAPSHOT_URL = "https://cfs.badjoke-lab.com/data/fee_snapshot_demo.json";
const RETENTION_DAYS = 30;
const PRUNE_BATCH_LIMIT = 5000;
const FETCH_TIMEOUT_MS = 10000;
const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

let lastSnapshotCache = null;

function toUnixSeconds(input) {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.floor(input > 1e12 ? input / 1000 : input);
  }
  if (typeof input === "string") {
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000);
    }
    const num = Number(input);
    if (Number.isFinite(num)) {
      return Math.floor(num > 1e12 ? num / 1000 : num);
    }
  }
  return null;
}

function getSnapshotTimestamp(data) {
  const candidates = [data?.generatedAt, data?.updatedAt, data?.updated, data?.timestamp];
  for (const value of candidates) {
    const ts = toUnixSeconds(value);
    if (ts !== null) return ts;
  }
  return Math.floor(Date.now() / 1000);
}

function parseChains(data) {
  if (!data || typeof data.chains !== "object" || data.chains === null) return [];
  const entries = Object.entries(data.chains);
  const rows = [];
  for (const [chain, payload] of entries) {
    if (typeof chain !== "string") continue;
    if (!payload || typeof payload !== "object") continue;
    rows.push({ chain, payload });
  }
  return rows;
}

async function upsertRetentionMeta(env, payload) {
  const statement = env.DB.prepare(
    `INSERT INTO retention_meta
      (id, retention_days, last_prune_at, last_prune_deleted, last_prune_ok, last_prune_error)
      VALUES (1, ?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(id) DO UPDATE SET
        retention_days = excluded.retention_days,
        last_prune_at = excluded.last_prune_at,
        last_prune_deleted = excluded.last_prune_deleted,
        last_prune_ok = excluded.last_prune_ok,
        last_prune_error = excluded.last_prune_error;`
  ).bind(
    payload.retentionDays,
    payload.lastPruneAt,
    payload.lastPruneDeleted,
    payload.lastPruneOk ? 1 : 0,
    payload.lastPruneError ?? null
  );
  await statement.run();
}

async function upsertFetchMeta(env, payload) {
  const statement = env.DB.prepare(
    `INSERT INTO fetch_meta
      (id, last_fetch_error, last_fetch_error_at, last_fetch_failure_key, last_fetch_failures, last_cache_used_at, last_cache_age_minutes, last_run_invalid_count, last_run_invalid_chains, last_run_warning_chains)
      VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(id) DO UPDATE SET
        last_fetch_error = excluded.last_fetch_error,
        last_fetch_error_at = excluded.last_fetch_error_at,
        last_fetch_failure_key = excluded.last_fetch_failure_key,
        last_fetch_failures = excluded.last_fetch_failures,
        last_cache_used_at = excluded.last_cache_used_at,
        last_cache_age_minutes = excluded.last_cache_age_minutes,
        last_run_invalid_count = excluded.last_run_invalid_count,
        last_run_invalid_chains = excluded.last_run_invalid_chains,
        last_run_warning_chains = excluded.last_run_warning_chains;`
  ).bind(
    payload.lastFetchError ?? null,
    payload.lastFetchErrorAt ?? null,
    payload.lastFetchFailureKey ?? null,
    payload.lastFetchFailures ?? null,
    payload.lastCacheUsedAt ?? null,
    payload.lastCacheAgeMinutes ?? null,
    payload.lastRunInvalidCount ?? null,
    payload.lastRunInvalidChains ?? null,
    payload.lastRunWarningChains ?? null
  );
  await statement.run();
}

async function pruneOldHistory(env) {
  const nowTs = Math.floor(Date.now() / 1000);
  const cutoffTs = nowTs - RETENTION_DAYS * 86400;
  const cutoffIso = new Date(cutoffTs * 1000).toISOString();

  const selectStmt = env.DB.prepare(
    "SELECT rowid FROM fee_history_points WHERE ts < ?1 ORDER BY ts ASC LIMIT ?2;"
  ).bind(cutoffTs, PRUNE_BATCH_LIMIT);
  const { results } = await selectStmt.all();
  const rowIds = (results || [])
    .map((row) => Number(row?.rowid))
    .filter((rowId) => Number.isFinite(rowId));

  if (!rowIds.length) {
    return { deletedCount: 0, cutoffIso, ok: true };
  }

  const placeholders = rowIds.map(() => "?").join(", ");
  const deleteStmt = env.DB.prepare(
    `DELETE FROM fee_history_points WHERE rowid IN (${placeholders});`
  ).bind(...rowIds);
  const result = await deleteStmt.run();
  const deletedCount = Number(result?.meta?.changes ?? 0);

  return { deletedCount, cutoffIso, ok: true };
}

function isRetryableError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  if (err.message === "timeout") return true;
  return err instanceof TypeError;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSnapshot(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!response.ok) {
        const error = new Error(`Snapshot fetch failed with status ${response.status}`);
        error.status = response.status;
        throw error;
      }
      try {
        return await response.json();
      } catch (err) {
        throw new Error("Snapshot fetch returned invalid JSON");
      }
    } catch (err) {
      lastError = err;
      if (attempt < 1 && isRetryableError(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function getFreshSnapshotCache() {
  if (!lastSnapshotCache) return null;
  const ageMs = Date.now() - lastSnapshotCache.cachedAtMs;
  if (ageMs > CACHE_MAX_AGE_MS) return null;
  return { ...lastSnapshotCache, ageMs };
}

async function writeRows(env, ts, rows) {
  if (!rows.length) return 0;
  const sql = `INSERT OR IGNORE INTO fee_history_points
    (ts, chain, fee_usd, fee_jpy, speed_sec, status, source, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const statements = rows.map(({ chain, feeUsd, feeJpy, speedSec, status }) =>
    env.DB.prepare(sql).bind(ts, chain, feeUsd, feeJpy, speedSec, status, "demo_snapshot", "typical_native_transfer")
  );
  await env.DB.batch(statements);
  return statements.length;
}

export default {
  async scheduled(_event, env, ctx) {
    const snapshotUrl = env.SNAPSHOT_URL || DEFAULT_SNAPSHOT_URL;
    let data;
    let fetchError = null;
    let cacheUsed = false;
    let cacheAgeMinutes = null;
    try {
      data = await fetchSnapshot(snapshotUrl);
      lastSnapshotCache = {
        data,
        cachedAt: new Date().toISOString(),
        cachedAtMs: Date.now(),
      };
    } catch (err) {
      fetchError = err;
      const cached = getFreshSnapshotCache();
      if (cached) {
        cacheUsed = true;
        cacheAgeMinutes = Math.round(cached.ageMs / 60000);
        data = cached.data;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        await upsertFetchMeta(env, {
          lastFetchError: message,
          lastFetchErrorAt: Math.floor(Date.now() / 1000),
          lastFetchFailureKey: "snapshot",
          lastFetchFailures: JSON.stringify([{ key: "snapshot", message, at: new Date().toISOString() }]),
          lastCacheUsedAt: null,
          lastCacheAgeMinutes: null,
          lastRunInvalidCount: null,
          lastRunInvalidChains: null,
          lastRunWarningChains: null,
        });
        console.error("Failed to fetch snapshot", message);
        return;
      }
    }

    const ts = getSnapshotTimestamp(data);
    console.log("Fetched snapshot ts", ts);
    const invalidChainKeys = new Set();
    const warningChainKeys = new Set();
    let invalidCount = 0;
    const rows = parseChains(data).map(({ chain, payload }) => {
      const { cleaned, invalidFields, warnings } = validateSnapshot(chain, payload);
      if (invalidFields.length) {
        invalidCount += invalidFields.length;
        invalidChainKeys.add(chain);
      }
      if (warnings.length) {
        warningChainKeys.add(chain);
      }
      return {
        chain,
        feeUsd: cleaned.feeUsd,
        feeJpy: cleaned.feeJpy,
        speedSec: cleaned.speedSec,
        status: cleaned.status,
      };
    });

    await upsertFetchMeta(env, {
      lastFetchError: fetchError ? (fetchError instanceof Error ? fetchError.message : String(fetchError)) : null,
      lastFetchErrorAt: fetchError ? Math.floor(Date.now() / 1000) : null,
      lastFetchFailureKey: fetchError ? "snapshot" : null,
      lastFetchFailures: fetchError
        ? JSON.stringify([
            { key: "snapshot", message: fetchError instanceof Error ? fetchError.message : String(fetchError), at: new Date().toISOString() },
          ])
        : null,
      lastCacheUsedAt: cacheUsed ? Math.floor(Date.now() / 1000) : null,
      lastCacheAgeMinutes: cacheUsed ? cacheAgeMinutes : null,
      lastRunInvalidCount: invalidCount,
      lastRunInvalidChains: JSON.stringify(Array.from(invalidChainKeys).slice(0, 10)),
      lastRunWarningChains: JSON.stringify(Array.from(warningChainKeys).slice(0, 10)),
    });

    const insertedPromise = rows.length
      ? writeRows(env, ts, rows).then((count) => {
          console.log("Inserted rows", count);
        })
      : Promise.resolve();

    const cleanupPromise = insertedPromise.then(async () => {
      let pruneResult = null;
      try {
        pruneResult = await pruneOldHistory(env);
        console.log("Prune completed", pruneResult);
        await upsertRetentionMeta(env, {
          retentionDays: RETENTION_DAYS,
          lastPruneAt: Math.floor(Date.now() / 1000),
          lastPruneDeleted: pruneResult.deletedCount,
          lastPruneOk: true,
          lastPruneError: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Prune failed", message);
        await upsertRetentionMeta(env, {
          retentionDays: RETENTION_DAYS,
          lastPruneAt: Math.floor(Date.now() / 1000),
          lastPruneDeleted: 0,
          lastPruneOk: false,
          lastPruneError: message,
        });
      }
    });

    ctx.waitUntil(Promise.all([insertedPromise, cleanupPromise]));
  },
};
