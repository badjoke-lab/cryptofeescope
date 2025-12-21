/*
 * Cloudflare Pages Function: /api/stats
 * Provides aggregated fee stats per chain and range from D1.
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

type StatsRow = {
  chain: string;
  count: number;
  first_ts: number | null;
  last_ts: number | null;
  avg_fee_usd: number | null;
  min_fee_usd: number | null;
  max_fee_usd: number | null;
  avg_speed_sec: number | null;
  min_speed_sec: number | null;
  max_speed_sec: number | null;
};

const RANGE_SECONDS: Record<string, number> = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

const CHAINS = new Set([
  "btc",
  "eth",
  "bsc",
  "sol",
  "tron",
  "avax",
  "xrp",
  "arbitrum",
  "optimism",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function parseRange(rangeParam: string | null): { label: string; seconds: number } | null {
  if (rangeParam === null || rangeParam === undefined || rangeParam === "") {
    return { label: "24h", seconds: RANGE_SECONDS["24h"] };
  }

  const seconds = RANGE_SECONDS[rangeParam];
  if (!seconds) return null;

  return { label: rangeParam, seconds };
}

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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const chainParam = url.searchParams.get("chain");
  const rangeParam = url.searchParams.get("range");

  const range = parseRange(rangeParam);
  if (!range) {
    return jsonResponse({ error: "Invalid range parameter." }, 400);
  }

  if (chainParam && !CHAINS.has(chainParam)) {
    return jsonResponse({ error: "Invalid chain parameter." }, 400);
  }

  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - range.seconds;

  let query = `SELECT
    chain,
    COUNT(*) AS count,
    MIN(ts) AS first_ts,
    MAX(ts) AS last_ts,
    AVG(fee_usd) AS avg_fee_usd,
    MIN(fee_usd) AS min_fee_usd,
    MAX(fee_usd) AS max_fee_usd,
    AVG(speed_sec) AS avg_speed_sec,
    MIN(speed_sec) AS min_speed_sec,
    MAX(speed_sec) AS max_speed_sec
  FROM fee_history_points
  WHERE ts >= ?1 AND ts <= ?2`;

  const params: Array<string | number> = [fromTs, toTs];

  if (chainParam) {
    query += " AND chain = ?3";
    params.push(chainParam);
  }

  query += "\n  GROUP BY chain\n  ORDER BY chain ASC;";

  const statement = env.DB.prepare(query).bind(...params);
  const { results } = await statement.all<StatsRow>();

  const chains = (results || []).map((row) => ({
    chain: row.chain,
    count: row.count,
    firstTs: row.first_ts ?? null,
    lastTs: row.last_ts ?? null,
    ageSec: row.last_ts != null ? toTs - row.last_ts : null,
    feeUsd: {
      avg: row.avg_fee_usd ?? null,
      min: row.min_fee_usd ?? null,
      max: row.max_fee_usd ?? null,
    },
    speedSec: {
      avg: row.avg_speed_sec ?? null,
      min: row.min_speed_sec ?? null,
      max: row.max_speed_sec ?? null,
    },
  }));

  const body = {
    range: range.label,
    fromTs,
    toTs,
    chains,
  };

  return jsonResponse(body, 200, true);
};

