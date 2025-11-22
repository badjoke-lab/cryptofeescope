// api/snapshot.js
// CryptoFeeScope snapshot API (3 chains: BTC, ETH, SOL)
// Reliability-first with caching and fallbacks.

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const TTL_MS = 60_000;
const DEFAULT_USD_TO_JPY = 150;

let LAST_PRICES = null;
let LAST_GOOD = null;
let LAST_AT = 0;

// ---------- 共通 ----------
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

// ---------- 価格（USD/JPY） ----------
async function getPrices() {
  const ids = ["bitcoin", "ethereum", "solana"];

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
    LAST_PRICES = {
      BTC: data.bitcoin || {},
      ETH: data.ethereum || {},
      SOL: data.solana || {},
    };
    return LAST_PRICES;
  } catch (e) {
    console.error("[snapshot] price fetch failed:", e.message);
    return (
      LAST_PRICES || {
        BTC: {},
        ETH: {},
        SOL: {},
      }
    );
  }
}

// ---------- BTC ----------
async function buildBitcoin(prices, generatedAt) {
  const fallback = LAST_GOOD?.chains?.btc;
  try {
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

    const main = tiers.find(t => t.label === "standard") || tiers[0] || null;
    const feeUSD = main?.feeUSD;
    const speedSec = main?.speedSec;
    const feeJPY = calcJpy(feeUSD, calcUsdToJpyRate(price));

    if (!Number.isFinite(feeUSD) || !Number.isFinite(speedSec)) {
      throw new Error("Invalid BTC fee data");
    }

    return {
      feeUSD,
      feeJPY,
      speedSec,
      status: decideStatus(feeUSD, speedSec),
      updated: generatedAt,
      tiers,
      ok: true,
    };
  } catch (e) {
    console.error("[snapshot] BTC failed:", e.message);
    if (fallback) return { ...fallback, updated: generatedAt, ok: true };

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
}

// ---------- ETH (Etherscan V2 Gas Oracle) ----------
async function buildEthereum(prices, generatedAt) {
  const fallback = LAST_GOOD?.chains?.eth;
  const priceObj = prices.ETH || {};
  const priceUsd = Number(priceObj.usd);
  const usdToJpy = calcUsdToJpyRate(priceObj);

  const GAS_LIMIT = 21000;
  const FALLBACK_GAS = { safe: 10, propose: 12, fast: 15 };

  try {
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      throw new Error("No ETH price");
    }

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

    const valid = [propose, fast, safe].every(v => Number.isFinite(v) && v >= 0.1);
    if (!valid) {
      throw new Error("Invalid gas price values from Etherscan V2");
    }

    const tiers = [
      mkEthTier("standard", propose, 120, priceUsd, usdToJpy, GAS_LIMIT),
      mkEthTier("fast", fast, 30, priceUsd, usdToJpy, GAS_LIMIT),
      mkEthTier("slow", safe, 300, priceUsd, usdToJpy, GAS_LIMIT),
    ];

    const main = tiers[0];
    const feeUSD = main.feeUSD;
    const speedSec = main.speedSec;

    LAST_GOOD = LAST_GOOD || {};

    return {
      feeUSD,
      feeJPY: main.feeJPY,
      speedSec,
      status: decideStatus(feeUSD, speedSec),
      updated: generatedAt,
      tiers,
      ok: true,
    };
  } catch (e) {
    console.error("[snapshot] ETH failed:", e.message);
    if (fallback) return { ...fallback, updated: generatedAt, ok: true };

    const tiers = [
      mkEthTier("standard", FALLBACK_GAS.propose, 120, priceUsd || 0, usdToJpy, GAS_LIMIT, true),
      mkEthTier("fast", FALLBACK_GAS.fast, 30, priceUsd || 0, usdToJpy, GAS_LIMIT, true),
      mkEthTier("slow", FALLBACK_GAS.safe, 300, priceUsd || 0, usdToJpy, GAS_LIMIT, true),
    ];
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
}

function mkEthTier(label, gwei, speedSec, priceUsd, usdToJpy, gasLimit, allowZeroPrice = false) {
  const g = Number(gwei);
  const price = Number(priceUsd);
  const hasPrice = Number.isFinite(price) && price > 0;
  const usePrice = hasPrice || allowZeroPrice;
  const gasPriceEth = Number.isFinite(g) ? g * 1e-9 : null;
  const feeEth = gasPriceEth !== null ? gasPriceEth * gasLimit : null;
  const feeUSD = feeEth !== null && usePrice ? feeEth * (hasPrice ? price : 1) : 0;
  const feeJPY = calcJpy(feeUSD, usdToJpy);
  return { label, feeUSD, feeJPY, speedSec };
}

// ---------- SOL ----------
async function buildSolana(prices, generatedAt) {
  const fallback = LAST_GOOD?.chains?.sol;
  try {
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
    const feeJPY = calcJpy(main.feeUSD, usdToJpy);
    return {
      feeUSD: main.feeUSD,
      feeJPY,
      speedSec: main.speedSec,
      status: decideStatus(main.feeUSD, main.speedSec),
      updated: generatedAt,
      tiers,
      ok: true,
    };
  } catch (e) {
    console.error("[snapshot] SOL failed:", e.message);
    if (fallback) return { ...fallback, updated: generatedAt, ok: true };

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
}

// ---------- ハンドラ ----------
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const now = Date.now();
  if (LAST_GOOD && now - LAST_AT < TTL_MS) {
    return res.status(200).json(LAST_GOOD);
  }

  const generatedAt = new Date().toISOString();

  try {
    const prices = await getPrices();

    const chains = {
      btc: await buildBitcoin(prices, generatedAt),
      eth: await buildEthereum(prices, generatedAt),
      sol: await buildSolana(prices, generatedAt),
    };

    const payload = { ok: true, generatedAt, chains };
    LAST_GOOD = payload;
    LAST_AT = Date.now();
    return res.status(200).json(payload);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);
    const chains = {
      btc: LAST_GOOD?.chains?.btc || baseChain(generatedAt),
      eth: LAST_GOOD?.chains?.eth || baseChain(generatedAt),
      sol: LAST_GOOD?.chains?.sol || baseChain(generatedAt),
    };
    const payload = { ok: true, generatedAt, chains };
    LAST_GOOD = LAST_GOOD || payload;
    LAST_AT = LAST_AT || Date.now();
    return res.status(200).json(payload);
  }
};
