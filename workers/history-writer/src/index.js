const DEFAULT_SNAPSHOT_URL = "https://cryptofeescope.pages.dev/data/fee_snapshot_demo.json";
const RETENTION_DAYS = 30;
const PRUNE_BATCH_LIMIT = 5000;

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

function sanitizeFee(value, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  if (typeof max === "number" && value > max) return null;
  return value;
}

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeSpeed(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 ? value : null;
}

function sanitizeStatus(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 24 ? trimmed : null;
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
    const feeUsd = normalizeNumber(payload.feeUSD);
    const feeJpy = normalizeNumber(payload.feeJPY);
    const speedSec = normalizeNumber(payload.speedSec);
    const status = sanitizeStatus(payload.status);
    rows.push({ chain, feeUsd, feeJpy, speedSec, status });
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

async function fetchSnapshot(url) {
  const response = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } });
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed with status ${response.status}`);
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error("Snapshot fetch returned invalid JSON");
  }
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
    try {
      data = await fetchSnapshot(snapshotUrl);
    } catch (err) {
      console.error("Failed to fetch snapshot", err?.message || err);
      return;
    }

    const ts = getSnapshotTimestamp(data);
    console.log("Fetched snapshot ts", ts);
    const rows = parseChains(data)
      .map(({ chain, feeUsd, feeJpy, speedSec, status }) => {
        const cleanedFeeUsd = sanitizeFee(feeUsd, 1000);
        const cleanedFeeJpy = sanitizeFee(feeJpy, 150000);
        const cleanedSpeed = sanitizeSpeed(speedSec);
        const cleanedStatus = sanitizeStatus(status);
        return {
          chain,
          feeUsd: cleanedFeeUsd,
          feeJpy: cleanedFeeJpy,
          speedSec: cleanedSpeed,
          status: cleanedStatus,
        };
      })
      .filter((row) => row.feeUsd !== null || row.feeJpy !== null);

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
