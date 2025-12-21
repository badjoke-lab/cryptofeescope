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

function sanitizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeStatus(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
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
    const feeUsd = sanitizeNumber(payload.feeUSD);
    const feeJpy = sanitizeNumber(payload.feeJPY);
    const speedSec = sanitizeNumber(payload.speedSec);
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
  return response.json();
}

async function writeRows(env, ts, rows) {
  if (!rows.length) return;
  const sql = `INSERT OR IGNORE INTO fee_history_points
    (ts, chain, fee_usd, fee_jpy, speed_sec, status, source, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const statements = rows.map(({ chain, feeUsd, feeJpy, speedSec, status }) =>
    env.DB.prepare(sql).bind(ts, chain, feeUsd, feeJpy, speedSec, status, "demo_snapshot", "typical_native_transfer")
  );
  await env.DB.batch(statements);
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
    const rows = parseChains(data);
    if (!rows.length) return;

    ctx.waitUntil(writeRows(env, ts, rows));
  },
};
