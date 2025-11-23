// api/snapshot.js
// Phase1 strict reliability snapshot (BTC / ETH / SOL only)
// - Etherscan V2 gasoracle
// - per-chain last_good cache only (NO mock fallback)
// - NOTOK / invalid -> cached if exists else failed
// - TTL to reduce calls
// - always 200

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const TTL_GLOBAL_MS = 60_000; // snapshot endpoint global cache
const DEFAULT_USD_TO_JPY = 150;

// per-chain TTL (live fetch interval)
const CHAIN_TTL_MS = {
  btc: 60_000,
  eth: 60_000,
  sol: 60_000,
  default: 60_000,
};

const PRICE_ID_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
};

// ETH model
const GAS_LIMIT = 21_000;

// module-level caches (survive within warm lambda)
let LAST_SNAPSHOT = null;
let LAST_AT = 0;
let LAST_PRICES = null;
/**
 * LAST_GOOD_CHAINS = {
 *   btc: { data: <chainPayload>, at: <ms> },
 *   eth: { ... },
 *   sol: { ... }
 * }
 */
let LAST_GOOD_CHAINS = {};

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

// ---------- price (BTC/ETH/SOL only) ----------
async function getPrices() {
  const ids = Object.values(PRICE_ID_MAP);

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

// ---------- ETH gas oracle (Etherscan v2) ----------
async function fetchGasOracleV2() {
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
  if (!valid) throw new Error("Invalid gas price values from Etherscan V2");

  return { propose, fast, safe };
}

function mkEthTier(label, gwei, speedSec, priceUsd, usdToJpy) {
  const g = Number(gwei);
  const price = Number(priceUsd);
  const hasPrice = Number.isFinite(price) && price > 0;

  if (!Number.isFinite(g) || !hasPrice) {
    return { label, feeUSD: null, feeJPY: null, speedSec };
  }

  const gasPriceEth = g * 1e-9;
  const feeEth = gasPriceEth * GAS_LIMIT;
  const feeUSD = feeEth * price;

  return {
    label,
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
  };
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

  const main = tiers.find(t => t.label === "standard") || tiers[0];
  if (!main || !Number.isFinite(main.feeUSD)) {
    throw new Error("Invalid BTC fee data");
  }

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

// ---------- ETH ----------
async function buildEthereum(ctx) {
  const { generatedAt, prices, gasOracle } = ctx;
  if (!gasOracle) throw new Error("No gas oracle available");

  const priceObj = prices.ETH || {};
  const priceUsd = Number(priceObj.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("No ETH price");
  }

  const usdToJpy = calcUsdToJpyRate(priceObj);

  const tiers = [
    mkEthTier("standard", gasOracle.propose, 120, priceUsd, usdToJpy),
    mkEthTier("fast", gasOracle.fast, 30, priceUsd, usdToJpy),
    mkEthTier("slow", gasOracle.safe, 300, priceUsd, usdToJpy),
  ];

  const main = tiers[0];
  if (!main || !Number.isFinite(main.feeUSD)) {
    throw new Error("Invalid ETH fee data");
  }

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

// ---------- SOL ----------
async function buildSolana(ctx) {
  const { generatedAt, prices } = ctx;
  const priceObj = prices.SOL || {};
  const priceUsd = Number(priceObj.usd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("No SOL price");
  }

  const usdToJpy = calcUsdToJpyRate(priceObj);

  const LAMPORTS_PER_SIGNATURE = 5000;
  const feeSol = LAMPORTS_PER_SIGNATURE / 1e9;
  const feeUSD = feeSol * priceUsd;

  const tiers = [
    { label: "standard", feeUSD, feeJPY: calcJpy(feeUSD, usdToJpy), speedSec: 10 },
    { label: "fast", feeUSD, feeJPY: calcJpy(feeUSD, usdToJpy), speedSec: 8 },
    { label: "slow", feeUSD, feeJPY: calcJpy(feeUSD, usdToJpy), speedSec: 20 },
  ];

  const main = tiers[0];
  if (!main || !Number.isFinite(main.feeUSD)) {
    throw new Error("Invalid SOL fee data");
  }

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

// ---------- resolve with strict last_good only ----------
async function resolveChain(chainId, builder, ctx) {
  const { now, generatedAt } = ctx;
  const cached = LAST_GOOD_CHAINS[chainId];
  const ttl = getChainTTL(chainId);

  // TTL hit -> cached
  if (cached && now - cached.at < ttl) {
    const staleSec = Math.floor((now - cached.at) / 1000);
    return chainWithSource(cached.data, "cached", staleSec);
  }

  try {
    const data = await builder(ctx);

    // live success -> store
    const payload = chainWithSource(data, "live", 0);
    LAST_GOOD_CHAINS[chainId] = { data: payload, at: now };
    return payload;
  } catch (e) {
    console.error(`[snapshot] ${chainId} failed:`, e.message || e);

    // strict last_good fallback only
    if (cached) {
      const staleSec = Math.floor((now - cached.at) / 1000);
      return chainWithSource(cached.data, "cached", staleSec);
    }

    // no cached -> failed
    return chainWithSource(
      baseFailedChain(generatedAt, e.message || "error"),
      "failed",
      0
    );
  }
}

// ---------- handler ----------
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const now = Date.now();

  // global TTL cache (reduces total calls)
  if (LAST_SNAPSHOT && now - LAST_AT < TTL_GLOBAL_MS) {
    return res.status(200).json(LAST_SNAPSHOT);
  }

  const generatedAt = new Date(now).toISOString();

  try {
    const prices = await getPrices();

    let gasOracle = null;
    try {
      gasOracle = await fetchGasOracleV2();
    } catch (e) {
      console.error("[snapshot] gas oracle fetch failed:", e.message || e);
      // keep null -> ETH resolveChain will fallback to last_good / failed
    }

    const ctx = { now, generatedAt, prices, gasOracle };

    const chains = {
      btc: await resolveChain("btc", buildBitcoin, ctx),
      eth: await resolveChain("eth", buildEthereum, ctx),
      sol: await resolveChain("sol", buildSolana, ctx),
    };

    const payload = { generatedAt, chains };

    LAST_SNAPSHOT = payload;
    LAST_AT = now;

    return res.status(200).json(payload);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);

    // even on fatal, never 500
    const chains = {
      btc: await resolveChain("btc", buildBitcoin, { now, generatedAt, prices: LAST_PRICES || {}, gasOracle: null }),
      eth: await resolveChain("eth", buildEthereum, { now, generatedAt, prices: LAST_PRICES || {}, gasOracle: null }),
      sol: await resolveChain("sol", buildSolana, { now, generatedAt, prices: LAST_PRICES || {}, gasOracle: null }),
    };

    const payload = { generatedAt, chains };
    LAST_SNAPSHOT = LAST_SNAPSHOT || payload;
    LAST_AT = LAST_AT || now;

    return res.status(200).json(payload);
  }
};
