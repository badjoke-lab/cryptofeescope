// api/snapshot.js
// CryptoFeeScope snapshot API (Route C)
// Targets: BTC / ETH / SOL / ARB / OP / BASE
// Reliability-first: per-chain last_good cache, NOTOK -> cached, TTL control, low call rate.
// CommonJS (Vercel Serverless)

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Etherscan V2 multi-chain base (single host, chainid param)
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

// Global snapshot TTL (avoid burst calls from many clients)
const TTL_GLOBAL_MS = 60_000;
const DEFAULT_USD_TO_JPY = 150;

let LAST_SNAPSHOT = null;
let LAST_AT = 0;
let LAST_PRICES = null;

// Per-chain last good cache
let LAST_GOOD_CHAINS = {};

// Per-chain TTL
const CHAIN_TTL_MS = {
  btc: 60_000,
  eth: 60_000,
  sol: 60_000,
  arb: 90_000,
  op: 90_000,
  base: 90_000,
  default: 180_000,
};

// Coingecko ids needed for USD/JPY rates
const PRICE_ID_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
};

// Fallbacks (used only when no cache exists)
const FALLBACK_GAS_GWEI = { safe: 10, propose: 12, fast: 15 };
const GAS_LIMIT = 21_000;

// ---------- common helpers ----------
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Accept": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function decideStatus(feeUsd, speedSec) {
  const fee = Number(feeUsd);
  const s = Number(speedSec);
  if (Number.isFinite(fee) && Number.isFinite(s)) {
    if (fee < 0.05 && s < 5 * 60) return "fast";
    if (fee > 1 || s > 60 * 60) return "slow";
    return "avg";
  }
  return "avg";
}

function calcUsdToJpyRate(priceObj) {
  const usd = Number(priceObj?.usd);
  const jpy = Number(priceObj?.jpy);
  if (!Number.isFinite(usd) || !Number.isFinite(jpy) || usd <= 0) return null;
  return jpy / usd;
}

function calcJpy(amountUsd, rate) {
  if (!Number.isFinite(amountUsd)) return null;
  const r = Number(rate);
  const usdToJpy = Number.isFinite(r) && r > 0 ? r : DEFAULT_USD_TO_JPY;
  return amountUsd * usdToJpy;
}

function baseFailedChain(nowIso, errorMessage = "") {
  return {
    feeUSD: null,
    feeJPY: null,
    speedSec: null,
    status: "failed",
    updated: nowIso,
    tiers: [
      { label: "standard", feeUSD: null, feeJPY: null, speedSec: null },
      { label: "fast", feeUSD: null, feeJPY: null, speedSec: null },
      { label: "slow", feeUSD: null, feeJPY: null, speedSec: null },
    ],
    ok: false,
    error: errorMessage ? errorMessage.slice(0, 200) : undefined,
  };
}

function chainWithSource(data, source, staleSec) {
  return { ...data, source, staleSec };
}

function getChainTTL(chainId) {
  return CHAIN_TTL_MS[chainId] ?? CHAIN_TTL_MS.default;
}

// ---------- prices (USD/JPY) ----------
async function getPrices() {
  const ids = Array.from(new Set(Object.values(PRICE_ID_MAP)));

  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd,jpy",
  });

  const usePro = !!COINGECKO_API_KEY;
  const baseUrl = usePro
    ? "https://pro-api.coingecko.com/api/v3/simple/price"
    : "https://api.coingecko.com/api/v3/simple/price";
  const headers = usePro ? { "x-cg-pro-api-key": COINGECKO_API_KEY } : {};

  try {
    const data = await fetchJson(`${baseUrl}?${params.toString()}`, { headers });
    LAST_PRICES = Object.keys(PRICE_ID_MAP).reduce((acc, key) => {
      const id = PRICE_ID_MAP[key];
      acc[key] = data[id] || {};
      return acc;
    }, {});
    return LAST_PRICES;
  } catch (e) {
    console.error("[snapshot] price fetch failed:", e.message);
    return (
      LAST_PRICES ||
      Object.keys(PRICE_ID_MAP).reduce((acc, key) => {
        acc[key] = {};
        return acc;
      }, {})
    );
  }
}

// ---------- Etherscan gas oracle (per chainid) ----------
async function fetchGasOracle(chainid) {
  const params = new URLSearchParams({
    chainid: String(chainid),
    module: "gastracker",
    action: "gasoracle",
  });
  if (ETHERSCAN_API_KEY) params.set("apikey", ETHERSCAN_API_KEY);
  const url = `${ETHERSCAN_V2_BASE}?${params.toString()}`;

  const data = await fetchJson(url);
  const r = data.result || {};

  if (data.status === "0" || data.message === "NOTOK") {
    throw new Error(`Gas oracle failed: ${data.message || data.result || "status 0"}`);
  }

  const propose = Number(r.ProposeGasPrice ?? r.proposeGasPrice);
  const fast = Number(r.FastGasPrice ?? r.fastGasPrice);
  const safe = Number(r.SafeGasPrice ?? r.safeGasPrice);

  const valid = [propose, fast, safe].every(v => Number.isFinite(v) && v > 0);
  if (!valid) {
    throw new Error("Invalid gas price values from Etherscan V2");
  }
  return { propose, fast, safe };
}

function mkEthTier(label, gwei, speedSec, priceUsd, usdToJpy) {
  const g = Number(gwei);
  const price = Number(priceUsd);
  const hasPrice = Number.isFinite(price) && price > 0;

  const gasPriceEth = Number.isFinite(g) ? g * 1e-9 : null;
  const feeEth = gasPriceEth !== null ? gasPriceEth * GAS_LIMIT : null;
  const feeUSD = feeEth !== null && hasPrice ? feeEth * price : null;

  return {
    label,
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
  };
}

function buildEvmTiers(gas, priceUsd, usdToJpy) {
  return [
    mkEthTier("standard", gas.propose, 120, priceUsd, usdToJpy),
    mkEthTier("fast", gas.fast, 30, priceUsd, usdToJpy),
    mkEthTier("slow", gas.safe, 300, priceUsd, usdToJpy),
  ];
}

// ---------- BTC ----------
async function buildBitcoin(ctx) {
  const { generatedAt, prices } = ctx;
  const price = prices.BTC || {};
  const priceUsd = Number(price.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("No BTC price");
  }

  const usdToJpy = calcUsdToJpyRate(price);
  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
  const TX_VBYTES = 140;

  const tiersSrc = [
    { label: "standard", feeRate: data.halfHourFee, speedSec: 30 * 60 },
    { label: "fast", feeRate: data.fastestFee, speedSec: 10 * 60 },
    { label: "slow", feeRate: data.hourFee, speedSec: 60 * 60 },
  ];

  const tiers = tiersSrc.map(t => {
    const rate = Number(t.feeRate);
    const feeBtc = Number.isFinite(rate) ? (rate * TX_VBYTES) / 1e8 : null;
    const feeUSD = feeBtc !== null ? feeBtc * priceUsd : null;
    return {
      label: t.label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, usdToJpy),
      speedSec: t.speedSec,
    };
  });

  const main = tiers.find(t => t.label === "standard") || tiers[0] || {};
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

  if (!Number.isFinite(feeUSD) || !Number.isFinite(speedSec)) {
    throw new Error("Invalid BTC fee data");
  }

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

async function fallbackBitcoin(ctx) {
  const { generatedAt } = ctx;
  const feeUSD = 0.15;
  const feeJPY = calcJpy(feeUSD, DEFAULT_USD_TO_JPY);
  const tiers = [
    { label: "standard", feeUSD, feeJPY, speedSec: 30 * 60 },
    { label: "fast", feeUSD, feeJPY, speedSec: 10 * 60 },
    { label: "slow", feeUSD, feeJPY, speedSec: 60 * 60 },
  ];
  return {
    feeUSD,
    feeJPY,
    speedSec: 30 * 60,
    status: decideStatus(feeUSD, 30 * 60),
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

// ---------- SOL ----------
async function buildSolana(ctx) {
  const { generatedAt, prices } = ctx;
  const price = prices.SOL || {};
  const priceUsd = Number(price.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("No SOL price");
  }

  const usdToJpy = calcUsdToJpyRate(price);
  const LAMPORTS_PER_SIGNATURE = 5000;
  const feeSol = LAMPORTS_PER_SIGNATURE / 1e9;
  const feeUSD = feeSol * priceUsd;

  const tiers = [
    { label: "standard", feeUSD, feeJPY: calcJpy(feeUSD, usdToJpy), speedSec: 10 },
    { label: "fast", feeUSD, feeJPY: calcJpy(feeUSD, usdToJpy), speedSec: 8 },
    { label: "slow", feeUSD, feeJPY: calcJpy(feeUSD, usdToJpy), speedSec: 20 },
  ];

  const main = tiers[0];
  return {
    feeUSD: main.feeUSD,
    feeJPY: calcJpy(main.feeUSD, usdToJpy),
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

async function fallbackSolana(ctx) {
  const { generatedAt } = ctx;
  const feeUSD = 0.0006;
  const feeJPY = calcJpy(feeUSD, DEFAULT_USD_TO_JPY);
  const tiers = [
    { label: "standard", feeUSD, feeJPY, speedSec: 10 },
    { label: "fast", feeUSD, feeJPY, speedSec: 8 },
    { label: "slow", feeUSD, feeJPY, speedSec: 20 },
  ];
  return {
    feeUSD,
    feeJPY,
    speedSec: 10,
    status: decideStatus(feeUSD, 10),
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

// ---------- EVM chains (ETH / ARB / OP / BASE) ----------
async function buildEvmChain(chainKey, chainidNum, ctx) {
  const { generatedAt, prices } = ctx;

  // fetch per-chain gas oracle (counts as 1 call)
  const gas = await fetchGasOracle(chainidNum);

  const ethPriceObj = prices.ETH || {};
  const ethUsd = Number(ethPriceObj.usd);
  const usdToJpy = calcUsdToJpyRate(ethPriceObj);

  if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
    throw new Error(`No ETH price for ${chainKey}`);
  }

  const tiers = buildEvmTiers(gas, ethUsd, usdToJpy);
  const main = tiers[0];
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

  if (!Number.isFinite(feeUSD) || !Number.isFinite(speedSec)) {
    throw new Error(`Invalid ${chainKey} fee data`);
  }

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

async function fallbackEvmChain(chainKey, ctx) {
  const { generatedAt, prices } = ctx;
  const ethPriceObj = prices.ETH || {};
  const ethUsd = Number(ethPriceObj.usd) || 1800;
  const usdToJpy = calcUsdToJpyRate(ethPriceObj) || DEFAULT_USD_TO_JPY;

  const tiers = buildEvmTiers(FALLBACK_GAS_GWEI, ethUsd, usdToJpy);
  const main = tiers[0];

  return {
    feeUSD: main.feeUSD,
    feeJPY: main.feeJPY,
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

// ---------- cache resolver ----------
async function resolveChain(chainId, builder, fallbackBuilder, ctx) {
  const now = ctx.now;
  const cached = LAST_GOOD_CHAINS[chainId];
  const ttl = getChainTTL(chainId);

  if (cached && now - cached.at < ttl) {
    const staleSec = Math.floor((now - cached.at) / 1000);
    return chainWithSource(cached.data, "cached", staleSec);
  }

  try {
    const data = await builder(ctx);
    const payload = chainWithSource(data, "live", 0);
    LAST_GOOD_CHAINS[chainId] = { data: payload, at: now };
    return payload;
  } catch (e) {
    console.error(`[snapshot] ${chainId} failed:`, e.message || e);
    if (cached) {
      const staleSec = Math.floor((now - cached.at) / 1000);
      return chainWithSource(cached.data, "cached", staleSec);
    }
    const fallback = await fallbackBuilder(ctx);
    const payload = chainWithSource(fallback, "fallback", 0);
    LAST_GOOD_CHAINS[chainId] = { data: payload, at: now };
    return payload;
  }
}

// Promise pool to avoid bursts
async function runPromisePool(tasks, limit = 2) {
  const results = {};
  let index = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (index < tasks.length) {
      const current = tasks[index++];
      results[current.key] = await current.fn();
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- handler ----------
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const now = Date.now();
  if (LAST_SNAPSHOT && now - LAST_AT < TTL_GLOBAL_MS) {
    return res.status(200).json(LAST_SNAPSHOT);
  }

  const generatedAt = new Date(now).toISOString();

  try {
    const prices = await getPrices();
    const ctx = { now, generatedAt, prices };

    // independent chains in small pool
    const independentTasks = [
      { key: "btc", fn: () => resolveChain("btc", buildBitcoin, fallbackBitcoin, ctx) },
      { key: "sol", fn: () => resolveChain("sol", buildSolana, fallbackSolana, ctx) },
    ];
    const independentResults = await runPromisePool(independentTasks, 2);

    // EVM chains sequentially to stay well under 5 calls/sec
    const evmDefs = [
      ["eth", 1],
      ["arb", 42161],
      ["op", 10],
      ["base", 8453],
    ];

    const evmResults = {};
    for (const [key, chainidNum] of evmDefs) {
      evmResults[key] = await resolveChain(
        key,
        c => buildEvmChain(key, chainidNum, c),
        c => fallbackEvmChain(key, c),
        ctx
      );
    }

    const chains = { ...independentResults, ...evmResults };
    const payload = { generatedAt, chains };

    LAST_SNAPSHOT = payload;
    LAST_AT = now;
    return res.status(200).json(payload);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);

    const chainKeys = ["btc", "eth", "sol", "arb", "op", "base"];
    const chains = chainKeys.reduce((acc, key) => {
      const cached = LAST_GOOD_CHAINS[key];
      const fallback = cached?.data || baseFailedChain(generatedAt, e.message || "error");
      acc[key] = chainWithSource(
        fallback,
        cached ? "cached" : "fallback",
        cached ? Math.floor((now - cached.at) / 1000) : 0
      );
      return acc;
    }, {});

    const payload = { generatedAt, chains };
    LAST_SNAPSHOT = LAST_SNAPSHOT || payload;
    LAST_AT = LAST_AT || now;

    return res.status(200).json(payload);
  }
};
