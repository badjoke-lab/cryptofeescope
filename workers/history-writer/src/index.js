const DEFAULT_SNAPSHOT_URL = "https://cryptofeescope.pages.dev/data/fee_snapshot_demo.json";

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

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  const int = Math.floor(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
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

    if (!rows.length) return;

    const insertedPromise = writeRows(env, ts, rows).then((count) => {
      console.log("Inserted rows", count);
    });

    const retentionDays = clampInt(env.HISTORY_RETENTION_DAYS ?? 7, 1, 90);
    const cleanupPromise = insertedPromise.then(async () => {
      const nowTs = Math.floor(Date.now() / 1000);
      const cutoffTs = nowTs - retentionDays * 86400;
      const deleteStmt = env.DB.prepare(
        "DELETE FROM fee_history_points\nWHERE ts < ?1;"
      ).bind(cutoffTs);
      const result = await deleteStmt.all();
      const deleted = Number(result?.results?.[0]?.changes ?? 0);
      console.log("Cleanup removed rows", deleted);
    });

    ctx.waitUntil(Promise.all([insertedPromise, cleanupPromise]));
  },
};
