// api/snapshot.js
// Reliability-first snapshot API with per-chain caching, Etherscan v2 gasoracle,
// strict rate-limit spacing, last_good cache, and anomaly guards.

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const TTL_GLOBAL_MS = 60_000;     // snapshot whole payload cache
const DEFAULT_USD_TO_JPY = 150;

// ---- caches ----
let LAST_SNAPSHOT = null;
let LAST_AT = 0;
let LAST_PRICES = null;
let LAST_GOOD_CHAINS = {}; // { [chainId]: { data, at } }

// ---- chain TTLs ----
const CHAIN_TTL_MS = {
  btc: 60_000,
  eth: 60_000,
  sol: 60_000,
  arb: 60_000,
  op: 60_000,
  base: 60_000,
  polygon: 90_000,
  bsc: 90_000,
  avax: 90_000,
  default: 120_000,
};

// ---- prices (coingecko ids) ----
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

// ---- EVM chainids for Etherscan v2 ----
const EVM_CHAINIDS = {
  eth: 1,
  arb: 42161,
  op: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  avax: 43114,
};

// ---- fallback prices (USD) if no price + no cache ----
const FALLBACK_TOKEN_PRICE_USD = {
  ETH: 2500,
  ARB: 1.0,
  OP: 1.5,
  BASE: 2500,
  POLYGON: 0.7,
  BSC: 600,
  AVAX: 40,
};

const FALLBACK_GAS = { safe: 5, propose: 10, fast: 20 };
const GAS_LIMIT = 21_000;

// ---- anomaly caps (USD) ----
// L2/cheap chains should never be $1+ for a simple transfer.
// If exceeded, treat as anomaly and fall back.
const ANOMALY_CAP_USD = {
  eth: 5.0,       // ETH mainnet can be higher but still keep some sanity
  arb: 0.5,
  op: 0.5,
  base: 0.5,
  polygon: 0.5,
  bsc: 0.5,
  avax: 0.5,
};

// ---------- common ----------
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
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

function baseChain(nowIso, errorMessage = "") {
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

// ---------- prices ----------
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

// ---------- Etherscan v2 gasoracle per chain ----------
async function fetchGasOracleV2(chainid) {
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
  if (!valid) throw new Error("Invalid gas price values from Etherscan V2");

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

  const chainid = EVM_CHAINIDS[chainKey];
  if (!chainid) throw new Error(`Unknown EVM chain: ${chainKey}`);

  // fetch gas for this chain (live)
  const gas = await fetchGasOracleV2(chainid);

  const priceObj = prices[chainKey.toUpperCase()] || {};
  const priceUsd = Number(priceObj.usd);
  const usdToJpy = calcUsdToJpyRate(priceObj);

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`No ${chainKey.toUpperCase()} price`);
  }

  const tiers = buildEvmTiers(gas, priceUsd, usdToJpy);
  const main = tiers[0];
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

  if (!Number.isFinite(feeUSD) || !Number.isFinite(speedSec)) {
    throw new Error(`Invalid ${chainKey} fee data`);
  }

  // anomaly guard
  const cap = ANOMALY_CAP_USD[chainKey];
  if (Number.isFinite(cap) && feeUSD > cap) {
    throw new Error(`Anomalous ${chainKey} feeUSD=${feeUSD} (> cap ${cap})`);
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
  const usdToJpy = DEFAULT_USD_TO_JPY;

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

// ---------- BTC ----------
async function buildBitcoin(ctx) {
  const prices = ctx.prices;
  const price = prices.BTC || {};
  const priceUsd = Number(price.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("No BTC price");

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
    updated: ctx.generatedAt,
    tiers,
    ok: true,
  };
}

async function fallbackBitcoin(ctx) {
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
    updated: ctx.generatedAt,
    tiers,
    ok: true,
  };
}

// ---------- SOL ----------
async function buildSolana(ctx) {
  const prices = ctx.prices;
  const price = prices.SOL || {};
  const priceUsd = Number(price.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("No SOL price");

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
    updated: ctx.generatedAt,
    tiers,
    ok: true,
  };
}

async function fallbackSolana(ctx) {
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
    updated: ctx.generatedAt,
    tiers,
    ok: true,
  };
}

// ---------- resolve with cache / last_good ----------
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

// ---------- strict rate-limit spacing for EVM calls ----------
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function resolveEvmWithSpacing(keys, ctx, spacingMs = 260) {
  const out = {};
  for (const key of keys) {
    out[key] = await resolveChain(
      key,
      c => buildEvmChain(key, c),
      c => fallbackEvmChain(key, c),
      ctx
    );
    await sleep(spacingMs); // keep under ~5 req/sec to Etherscan v2
  }
  return out;
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

    // Non-EVM first (cheap, independent)
    const btc = await resolveChain("btc", buildBitcoin, fallbackBitcoin, ctx);
    const sol = await resolveChain("sol", buildSolana, fallbackSolana, ctx);

    // EVM chains spaced to respect v2 limit
    const evmKeys = ["eth", "arb", "op", "base", "polygon", "bsc", "avax"];
    const evmResults = await resolveEvmWithSpacing(evmKeys, ctx, 260);

    const chains = { btc, sol, ...evmResults };

    const payload = { generatedAt, chains };
    LAST_SNAPSHOT = payload;
    LAST_AT = now;
    return res.status(200).json(payload);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);
    const chainKeys = ["btc","eth","sol","arb","op","base","polygon","bsc","avax"];
    const chains = chainKeys.reduce((acc, key) => {
      const cached = LAST_GOOD_CHAINS[key];
      const fallback = cached?.data || baseChain(generatedAt, e.message || "error");
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
