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
  ts: number;
  fee_usd: number | null;
  speed_sec: number | null;
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
  "gnosis",
  "fantom",
  "cronos",
]);

const WINDOW_REQUIREMENTS: Record<
  string,
  { minPoints: number; maxGapSec: number }
> = {
  "24h": { minPoints: 12, maxGapSec: 6 * 60 * 60 },
  "7d": { minPoints: 84, maxGapSec: 24 * 60 * 60 },
};

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidFee(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isValidSpeed(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function computeStats(values: number[]) {
  if (!values.length) {
    return { avg: null, min: null, max: null };
  }
  let sum = 0;
  let min = values[0];
  let max = values[0];
  values.forEach((value) => {
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  });
  return {
    avg: sum / values.length,
    min,
    max,
  };
}

function computeWindowStats(rangeLabel: string, points: StatsRow[]) {
  const requirements = WINDOW_REQUIREMENTS[rangeLabel];
  const feePoints = points
    .filter((pt) => isFiniteNumber(pt.ts) && isValidFee(pt.fee_usd))
    .sort((a, b) => a.ts - b.ts);

  const count = feePoints.length;
  const firstTs = count ? feePoints[0].ts : null;
  const lastTs = count ? feePoints[count - 1].ts : null;

  let status: "ok" | "insufficient" = "ok";
  let reason: "too_few_points" | "gap_too_large" | null = null;

  if (requirements) {
    if (count < requirements.minPoints) {
      status = "insufficient";
      reason = "too_few_points";
    } else if (count >= 2) {
      let maxGapSec = 0;
      for (let i = 1; i < feePoints.length; i += 1) {
        const gap = feePoints[i].ts - feePoints[i - 1].ts;
        if (gap > maxGapSec) maxGapSec = gap;
      }
      if (maxGapSec > requirements.maxGapSec) {
        status = "insufficient";
        reason = "gap_too_large";
      }
    }
  }

  if (status === "insufficient") {
    return {
      status,
      reason,
      count,
      firstTs,
      lastTs,
      feeUsd: { avg: null, min: null, max: null },
      speedSec: { avg: null, min: null, max: null },
    };
  }

  const feeStats = computeStats(feePoints.map((pt) => pt.fee_usd as number));
  const speedPoints = feePoints
    .map((pt) => pt.speed_sec)
    .filter(isValidSpeed);
  const speedStats = computeStats(speedPoints);

  return {
    status,
    reason,
    count,
    firstTs,
    lastTs,
    feeUsd: feeStats,
    speedSec: speedStats,
  };
}

export const onRequestOptions: PagesFunction = () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const chainParam = url.searchParams.get("chain");
    const rangeParam = url.searchParams.get("range");

    const range = parseRange(rangeParam);
    if (!range) {
      return jsonResponse({ ok: false, error: "Invalid range parameter." }, 400);
    }

    if (chainParam && !CHAINS.has(chainParam)) {
      return jsonResponse({ ok: false, error: "Invalid chain parameter." }, 400);
    }

    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - range.seconds;

    let query = `SELECT
      chain,
      ts,
      fee_usd,
      speed_sec
    FROM fee_history_points
    WHERE ts >= ?1 AND ts <= ?2`;

    const params: Array<string | number> = [fromTs, toTs];

    if (chainParam) {
      query += " AND chain = ?3";
      params.push(chainParam);
    }

    query += "\n    ORDER BY chain ASC, ts ASC;";

    const statement = env.DB.prepare(query).bind(...params);
    const { results } = await statement.all<StatsRow>();

    const grouped = new Map<string, StatsRow[]>();
    for (const row of results || []) {
      if (!grouped.has(row.chain)) {
        grouped.set(row.chain, []);
      }
      grouped.get(row.chain)?.push(row);
    }

    const chains = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([chain, rows]) => {
        const computed = computeWindowStats(range.label, rows);
        return {
          chain,
          count: computed.count,
          firstTs: computed.firstTs,
          lastTs: computed.lastTs,
          ageSec: computed.lastTs != null ? toTs - computed.lastTs : null,
          feeUsd: computed.feeUsd,
          speedSec: computed.speedSec,
          status: computed.status,
          reason: computed.reason,
        };
      });

    const latestTsOverall = chains.reduce<number | null>((acc, c) => {
      if (c.lastTs == null) return acc;
      if (acc == null || c.lastTs > acc) return c.lastTs;
      return acc;
    }, null);

    const body = {
      ok: true,
      data: {
        range: range.label,
        fromTs,
        toTs,
        chains,
      },
      meta: {
        newestTs: latestTsOverall,
        fromTs,
        toTs,
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
