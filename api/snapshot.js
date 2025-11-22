// api/snapshot.js
// CryptoFeeScope snapshot API (3 chains: BTC, ETH, SOL)
// - BTC: mempool.space recommended fees
// - ETH: Etherscan V2 Gas Oracle (Multichain API)
// - SOL: fixed lamports-per-signature estimate
// NOTE: other chains are removed by design to reduce noise & rate limits.

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

// Etherscan V2 Multichain base
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

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
  if (!Number.isFinite(amountUsd) || !Number.isFinite(rate)) return null;
  return amountUsd * rate;
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

let LAST_PRICES = null;

async function safeBuild(builder, generatedAt) {
  try {
    const result = await builder();
    return { ok: true, ...result };
  } catch (e) {
    console.error("[snapshot] chain failed:", e.message);
    return baseFailedChain(generatedAt, e.message || "error");
  }
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
async function buildBitcoin(prices) {
  const price = prices.BTC;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No BTC price");

  const usdToJpy = calcUsdToJpyRate(price);

  // mempool recommended fee rates (sat/vB)
  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
  const TX_VBYTES = 140;

  const tiersSrc = [
    { label: "standard", feeRate: data.halfHourFee, speedSec: 30 * 60 },
    { label: "fast", feeRate: data.fastestFee, speedSec: 10 * 60 },
    { label: "slow", feeRate: data.hourFee, speedSec: 60 * 60 },
  ];

  const tiers = tiersSrc.map(t => {
    const feeBtc = (t.feeRate * TX_VBYTES) / 1e8;
    const feeUSD = feeBtc * priceUsd;
    return {
      label: t.label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, usdToJpy),
      speedSec: t.speedSec,
    };
  });

  const main = tiers.find(t => t.label === "standard") || tiers[0] || null;
  const now = new Date().toISOString();

  const feeUSD = main ? main.feeUSD : null;
  const speedSec = main ? main.speedSec : null;

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: now,
    tiers,
  };
}

// ---------- ETH (Etherscan V2 Gas Oracle) ----------
async function buildEthereum(prices) {
  const priceObj = prices.ETH;
  const priceUsd = Number(priceObj?.usd);
  const usdToJpy = calcUsdToJpyRate(priceObj);
  const hasPrice = Number.isFinite(priceUsd) && priceUsd > 0;
  if (!hasPrice) throw new Error("No ETH price");

  const params = new URLSearchParams({
    chainid: "1",
    module: "gastracker",
    action: "gasoracle",
  });
  if (ETHERSCAN_API_KEY) params.set("apikey", ETHERSCAN_API_KEY);

  const url = `${ETHERSCAN_V2_BASE}?${params.toString()}`;
  const data = await fetchJson(url);

  // V2 still returns { status, message, result } in most cases
  const r = data.result || {};
  if (data.status === "0" || data.message === "NOTOK") {
    throw new Error(`Gas oracle failed: ${data.message || data.result || "status 0"}`);
  }

  const propose = r.ProposeGasPrice ?? r.proposeGasPrice;
  const fast = r.FastGasPrice ?? r.fastGasPrice;
  const safe = r.SafeGasPrice ?? r.safeGasPrice;

  if (propose === undefined && fast === undefined && safe === undefined) {
    throw new Error("Missing gas price fields from Etherscan V2");
  }

  const GAS_LIMIT = 21000;

  function mkTier(label, gwei, speedSec) {
    const g = Number(gwei);
    if (!Number.isFinite(g)) return { label, feeUSD: null, feeJPY: null, speedSec };
    const gasPriceEth = g * 1e-9;        // gwei -> ETH per gas
    const feeEth = gasPriceEth * GAS_LIMIT;
    const feeUSD = feeEth * priceUsd;
    return {
      label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, usdToJpy),
      speedSec,
    };
  }

  const tiers = [
    mkTier("standard", propose ?? fast ?? safe, 120),
    mkTier("fast", fast ?? propose ?? safe, 30),
    mkTier("slow", safe ?? propose ?? fast, 300),
  ];

  const main = tiers.find(t => t.label === "standard") || tiers[0] || null;
  const now = new Date().toISOString();

  const feeUSD = main ? main.feeUSD : null;
  const speedSec = main ? main.speedSec : null;

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: now,
    tiers,
  };
}

// ---------- SOL ----------
async function buildSolana(prices) {
  const price = prices.SOL;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No SOL price");

  const usdToJpy = calcUsdToJpyRate(price);

  // typical transfer: 1 signature, 5000 lamports
  const LAMPORTS_PER_SIGNATURE = 5000;
  const lamports = LAMPORTS_PER_SIGNATURE;
  const feeSol = lamports / 1e9;
  const feeUsd = feeSol * priceUsd;

  const tiers = [
    { label: "standard", feeUSD: feeUsd, feeJPY: calcJpy(feeUsd, usdToJpy), speedSec: 10 },
    { label: "fast", feeUSD: feeUsd, feeJPY: calcJpy(feeUsd, usdToJpy), speedSec: 8 },
    { label: "slow", feeUSD: feeUsd, feeJPY: calcJpy(feeUsd, usdToJpy), speedSec: 20 },
  ];

  const main = tiers[0];
  const now = new Date().toISOString();

  return {
    feeUSD: main.feeUSD,
    feeJPY: main.feeJPY,
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: now,
    tiers,
  };
}

// ---------- ハンドラ ----------
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const generatedAt = new Date().toISOString();

  try {
    const prices = await getPrices();

    const chains = {
      btc: await safeBuild(() => buildBitcoin(prices), generatedAt),
      eth: await safeBuild(() => buildEthereum(prices), generatedAt),
      sol: await safeBuild(() => buildSolana(prices), generatedAt),
    };

    return res.status(200).json({ generatedAt, chains });
  } catch (e) {
    console.error("[snapshot] fatal error:", e);
    const failedChains = {
      btc: baseFailedChain(generatedAt, e.message || "error"),
      eth: baseFailedChain(generatedAt, e.message || "error"),
      sol: baseFailedChain(generatedAt, e.message || "error"),
    };
    return res.status(200).json({ generatedAt, chains: failedChains });
  }
};
