// api/snapshot.js
// Reliability-first snapshot API with per-chain caching and fallbacks.

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const TTL_GLOBAL_MS = 60_000;
const DEFAULT_USD_TO_JPY = 150;

let LAST_SNAPSHOT = null;
let LAST_AT = 0;
let LAST_PRICES = null;
let LAST_GOOD_CHAINS = {};

const CHAIN_TTL_MS = {
  btc: 60_000,
  eth: 60_000,
  sol: 60_000,
  xrp: 120_000,
  tron: 120_000,
  default: 180_000,
};

const PRICE_ID_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  ARB: "arbitrum",
  OP: "optimism",
  BASE: "base",
  POLYGON: "polygon",
  BSC: "binancecoin",
  AVAX: "avalanche-2",
};

const FALLBACK_TOKEN_PRICE_USD = {
  ETH: 1800,
  ARB: 1.2,
  OP: 1.2,
  BASE: 1800,
  POLYGON: 0.7,
  BSC: 230,
  AVAX: 30,
};

const FALLBACK_GAS = { safe: 10, propose: 12, fast: 15 };
const GAS_LIMIT = 21_000;

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

function baseChain(nowIso) {
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
  };
}

function chainWithSource(data, source, staleSec) {
  return { ...data, source, staleSec };
}

function getChainTTL(chainId) {
  return CHAIN_TTL_MS[chainId] ?? CHAIN_TTL_MS.default;
}

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

async function fetchGasOracle() {
  const params = new URLSearchParams({
    chainid: "1",
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

function mkEthTier(label, gwei, speedSec, priceUsd, usdToJpy, gasLimit) {
  const g = Number(gwei);
  const price = Number(priceUsd);
  const hasPrice = Number.isFinite(price) && price > 0;
  const gasPriceEth = Number.isFinite(g) ? g * 1e-9 : null;
  const feeEth = gasPriceEth !== null ? gasPriceEth * gasLimit : null;
  const feeUSD = feeEth !== null && hasPrice ? feeEth * price : null;
  const feeJPY = calcJpy(feeUSD, usdToJpy);
  return { label, feeUSD, feeJPY, speedSec };
}

async function buildBitcoin(ctx) {
  const generatedAt = ctx.generatedAt;
  const prices = ctx.prices;
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
  const generatedAt = ctx.generatedAt;
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

async function buildSolana(ctx) {
  const generatedAt = ctx.generatedAt;
  const prices = ctx.prices;
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
  const generatedAt = ctx.generatedAt;
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

function evmPrice(chainKey, prices) {
  const upper = chainKey.toUpperCase();
  if (upper === "BASE") return prices.ETH || {};
  return prices[upper] || {};
}

function buildEvmTiers(gas, priceUsd, usdToJpy) {
  return [
    mkEthTier("standard", gas.propose, 120, priceUsd, usdToJpy, GAS_LIMIT),
    mkEthTier("fast", gas.fast, 30, priceUsd, usdToJpy, GAS_LIMIT),
    mkEthTier("slow", gas.safe, 300, priceUsd, usdToJpy, GAS_LIMIT),
  ];
}

async function buildEvmChain(chainKey, ctx) {
  const generatedAt = ctx.generatedAt;
  const prices = ctx.prices;
  const gas = ctx.gasOracle;
  if (!gas) throw new Error("No gas oracle available");

  const priceObj = evmPrice(chainKey, prices);
  const priceUsd = Number(priceObj.usd);
  const usdToJpy = calcUsdToJpyRate(priceObj);

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`No ${chainKey} price`);
  }

  const tiers = buildEvmTiers(gas, priceUsd, usdToJpy);
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
  const generatedAt = ctx.generatedAt;
  const priceUsd = FALLBACK_TOKEN_PRICE_USD[chainKey.toUpperCase()] || 1;
  const usdToJpy = DEFAULT_USD_TO_JPY / 1; // convert using default rate if missing
  const tiers = buildEvmTiers(FALLBACK_GAS, priceUsd, usdToJpy);
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
    let gasOracle = null;
    try {
      gasOracle = await fetchGasOracle();
    } catch (e) {
      console.error("[snapshot] gas oracle fetch failed:", e.message || e);
    }

    const ctx = { now, generatedAt, prices, gasOracle };

    const independentTasks = [
      { key: "btc", fn: () => resolveChain("btc", buildBitcoin, fallbackBitcoin, ctx) },
      { key: "sol", fn: () => resolveChain("sol", buildSolana, fallbackSolana, ctx) },
    ];

    const independentResults = await runPromisePool(independentTasks, 2);

    const evmChains = ["eth", "arb", "op", "base", "polygon", "bsc", "avax"];
    const evmResults = {};
    for (const key of evmChains) {
      evmResults[key] = await resolveChain(key, c => buildEvmChain(key, c), c => fallbackEvmChain(key, c), ctx);
    }

    const chains = {
      ...independentResults,
      ...evmResults,
    };

    const payload = { generatedAt, chains };
    LAST_SNAPSHOT = payload;
    LAST_AT = now;
    return res.status(200).json(payload);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);
    const chainKeys = ["btc", "eth", "sol", "arb", "op", "base", "polygon", "bsc", "avax"];
    const chains = chainKeys.reduce((acc, key) => {
      const cached = LAST_GOOD_CHAINS[key];
      const fallback = cached?.data || baseChain(generatedAt);
      acc[key] = chainWithSource(fallback, cached ? "cached" : "fallback", cached ? Math.floor((now - cached.at) / 1000) : 0);
      return acc;
    }, {});
    const payload = { generatedAt, chains };
    LAST_SNAPSHOT = LAST_SNAPSHOT || payload;
    LAST_AT = LAST_AT || now;
    return res.status(200).json(payload);
  }
};
