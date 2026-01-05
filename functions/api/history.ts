/*
 * Cloudflare Pages Function: /api/history
 * Provides time-series fee history per chain and range from D1.
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

type HistoryRow = {
  ts: number;
  fee_usd: number | null;
  fee_jpy: number | null;
  speed_sec: number | null;
  status: string | null;
  source: string | null;
  model: string | null;
};

const RANGE_SECONDS: Record<string, number> = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

const DEFAULT_LIMITS: Record<string, number> = {
  "1h": 360,
  "6h": 720,
  "24h": 1440,
  "7d": 2000,
  "30d": 2000,
};

const MAX_POINTS_7D = 500;

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
  "gnosis",
  "fantom",
  "cronos",
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

function parseLimit(limitParam: string | null, rangeLabel: string): number | null {
  if (!limitParam || limitParam.trim() === "") {
    return DEFAULT_LIMITS[rangeLabel] ?? 2000;
  }
  if (!/^\d+$/.test(limitParam)) return null;
  const limit = Number(limitParam);
  if (!Number.isInteger(limit) || limit <= 0) return null;
  return Math.min(limit, 2000);
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
  try {
    const url = new URL(request.url);
    const chain = url.searchParams.get("chain");
    const rangeParam = url.searchParams.get("range");
    const limitParam = url.searchParams.get("limit");

    if (!chain || !CHAINS.has(chain)) {
      return jsonResponse({ ok: false, error: "Invalid or missing chain parameter." }, 400);
    }

    const range = parseRange(rangeParam);
    if (!range) {
      return jsonResponse({ ok: false, error: "Invalid range parameter." }, 400);
    }

    const limit = parseLimit(limitParam, range.label);
    if (limit === null) {
      return jsonResponse({ ok: false, error: "Invalid limit parameter." }, 400);
    }

    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - range.seconds;

    const statement = env.DB.prepare(
      `SELECT ts, fee_usd, fee_jpy, speed_sec, status, source, model
       FROM fee_history_points
       WHERE chain = ?1 AND ts >= ?2 AND ts <= ?3
       ORDER BY ts ASC
       LIMIT ?4;`
    ).bind(chain, fromTs, toTs, limit);

    const { results } = await statement.all<HistoryRow>();
    const mapped = (results || []).map((row) => ({
      ts: row.ts,
      feeUsd: row.fee_usd ?? null,
      feeJpy: row.fee_jpy ?? null,
      speedSec: row.speed_sec ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
      model: row.model ?? null,
    }));

    const newestTs = mapped.length ? mapped[mapped.length - 1].ts : null;
    let points = mapped;
    let downsampled = false;
    if (range.label === "7d" && points.length > MAX_POINTS_7D) {
      const step = Math.ceil(points.length / MAX_POINTS_7D);
      const filtered = points.filter((_, idx) => idx % step === 0);
      const lastPoint = points[points.length - 1];
      if (filtered[filtered.length - 1]?.ts !== lastPoint.ts) {
        filtered.push(lastPoint);
      }
      while (filtered.length > MAX_POINTS_7D) {
        filtered.shift();
      }
      points = filtered;
      downsampled = true;
    }

    const body = {
      ok: true,
      data: {
        chain,
        range: range.label,
        fromTs,
        toTs,
        count: points.length,
        points,
      },
      meta: {
        newestTs,
        fromTs,
        toTs,
        downsampled,
        originalCount: mapped.length,
      },
    };

    return jsonResponse(body, 200, true);
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      500
    );
  }
};
