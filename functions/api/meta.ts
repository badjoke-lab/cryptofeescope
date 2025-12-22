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
    const body = {
      ok: true,
      data: {
        nowTs,
        latestTsByChain,
        latestTsOverall,
        ageSecOverall,
        lastWrittenAt: latestTsOverall,
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
