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
