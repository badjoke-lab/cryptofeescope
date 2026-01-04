/*
 * Cloudflare Pages Function: /api/meta
 * Provides latest timestamps per chain for freshness indicators.
 */

type PagesFunction<E = any> = (context: {
  request: Request;
  env: E;
  params: Record<string, string>;
}) => Promise<Response> | Response;

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  all: <T = unknown>() => Promise<{ results: T[] }>;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

type Env = {
  DB: D1Database;
};

type LatestRow = {
  chain: string;
  last_ts: number | null;
};

type LatestOkRow = {
  last_ok_ts: number | null;
};

type WindowTsRow = {
  ts: number;
};

type RetentionRow = {
  retention_days: number;
  last_prune_at: number | null;
  last_prune_deleted: number | null;
  last_prune_ok: number | null;
  last_prune_error: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200, cache = false): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...corsHeaders,
  };
  if (cache) {
    headers["Cache-Control"] = "public, max-age=60";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export const onRequestOptions: PagesFunction = () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

function toIsoString(ts: number | null): string | null {
  if (ts == null) return null;
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function computeStale(
  nowTs: number,
  lastWriteTs: number | null,
  lastOkTs: number | null
): { stale: boolean; reason: "no_write" | "write_too_old" | "ok_too_old" | null } {
  if (lastWriteTs == null) {
    return { stale: true, reason: "no_write" };
  }
  if (nowTs - lastWriteTs > 2 * 60 * 60) {
    return { stale: true, reason: "write_too_old" };
  }
  if (lastOkTs == null || nowTs - lastOkTs > 6 * 60 * 60) {
    return { stale: true, reason: "ok_too_old" };
  }
  return { stale: false, reason: null };
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const nowTs = Math.floor(Date.now() / 1000);
    const statement = env.DB.prepare(
      `SELECT chain, MAX(ts) AS last_ts
       FROM fee_history_points
       GROUP BY chain;`
    );
    const { results } = await statement.all<LatestRow>();
    const latestTsByChain: Record<string, number> = {};
    let latestTsOverall: number | null = null;

    for (const row of results || []) {
      if (row.last_ts == null) continue;
      latestTsByChain[row.chain] = row.last_ts;
      if (latestTsOverall === null || row.last_ts > latestTsOverall) {
        latestTsOverall = row.last_ts;
      }
    }

    const ageSecOverall = latestTsOverall != null ? nowTs - latestTsOverall : null;
    const okStmt = env.DB.prepare(
      `SELECT MAX(ts) AS last_ok_ts
       FROM fee_history_points
       WHERE status IS NOT NULL AND status != 'error';`
    );
    const okResult = await okStmt.all<LatestOkRow>();
    const lastOkTs = okResult.results?.[0]?.last_ok_ts ?? null;

    const windowHours = 24;
    const cutoffTs = nowTs - windowHours * 60 * 60;
    const windowStmt = env.DB.prepare(
      `SELECT DISTINCT ts
       FROM fee_history_points
       WHERE ts >= ?1 AND (fee_usd IS NOT NULL OR fee_jpy IS NOT NULL)
       ORDER BY ts ASC;`
    ).bind(cutoffTs);
    const windowResult = await windowStmt.all<WindowTsRow>();
    const windowRows = windowResult.results || [];
    const points24h = windowRows.length;
    let maxGapSec = 0;
    for (let i = 1; i < windowRows.length; i += 1) {
      const gap = windowRows[i].ts - windowRows[i - 1].ts;
      if (gap > maxGapSec) maxGapSec = gap;
    }
    const maxGapHours24h = maxGapSec / 3600;
    const staleInfo = computeStale(nowTs, latestTsOverall, lastOkTs);

    let retentionMeta: RetentionRow | null = null;
    try {
      const retentionStmt = env.DB.prepare(
        `SELECT retention_days, last_prune_at, last_prune_deleted, last_prune_ok, last_prune_error
         FROM retention_meta
         WHERE id = 1;`
      );
      const retentionResult = await retentionStmt.all<RetentionRow>();
      retentionMeta = retentionResult.results?.[0] ?? null;
    } catch {
      retentionMeta = null;
    }
    const body = {
      ok: true,
      data: {
        nowTs,
        latestTsByChain,
        latestTsOverall,
        ageSecOverall,
        lastWrittenAt: latestTsOverall,
        lastWriteAt: toIsoString(latestTsOverall),
        lastOkAt: toIsoString(lastOkTs),
        windowHours,
        points24h,
        maxGapHours24h,
        stale: staleInfo.stale,
        staleReason: staleInfo.reason,
        retentionDays: retentionMeta?.retention_days ?? 30,
        lastPruneAt: retentionMeta?.last_prune_at ?? null,
        lastPruneDeleted: retentionMeta?.last_prune_deleted ?? null,
        lastPruneOk:
          retentionMeta?.last_prune_ok != null
            ? Boolean(retentionMeta.last_prune_ok)
            : null,
        lastPruneError: retentionMeta?.last_prune_error ?? null,
      },
    };

    return jsonResponse(body, 200, true);
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
};
