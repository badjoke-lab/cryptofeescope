// api/snapshot.js
// CryptoFeeScope snapshot API (8 chains)

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

const EXPLORER_CONFIGS = {
  eth: {
    baseUrl: "https://api.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  arb: {
    baseUrl: "https://api.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  op: {
    baseUrl: "https://api-optimistic.etherscan.io/api",
    apiKey: process.env.OPTIMISTIC_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  base: {
    baseUrl: "https://api.basescan.org/api",
    apiKey: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  polygon: {
    baseUrl: "https://api.polygonscan.com/api",
    apiKey: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  bsc: {
    baseUrl: "https://api.bscscan.com/api",
    apiKey: process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
};

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
  const ids = [
    "bitcoin",
    "ethereum",
    "solana",
    "arbitrum",
    "optimism",
    "matic-network",
    "binancecoin",
  ];

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
      ARB: data.arbitrum || {},
      OP: data.optimism || {},
      MATIC: data["matic-network"] || {},
      BNB: data.binancecoin || {},
    };
    return LAST_PRICES;
  } catch (e) {
    console.error("[snapshot] price fetch failed:", e.message);
    return LAST_PRICES || { BTC: {}, ETH: {}, SOL: {}, ARB: {}, OP: {}, MATIC: {}, BNB: {} };
  }
}

// ---------- BTC ----------
async function buildBitcoin(prices) {
  const price = prices.BTC;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No BTC price");

  const usdToJpy = calcUsdToJpyRate(price);
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

// ---------- ETH ----------
async function buildEthereum(prices) {
  return buildScanGasChain(prices.ETH, EXPLORER_CONFIGS.eth);
}

// ---------- 共通: Etherscan 互換チェーン ----------
async function buildScanGasChain(priceObj, explorerCfg) {
  const priceUsd = Number(priceObj?.usd);
  const usdToJpy = calcUsdToJpyRate(priceObj);
  const hasPrice = Number.isFinite(priceUsd) && priceUsd > 0;
  if (!explorerCfg?.baseUrl) {
    throw new Error("Explorer config missing");
  }

  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
  });
  if (explorerCfg.apiKey) params.set("apikey", explorerCfg.apiKey);

  const url = `${explorerCfg.baseUrl}?${params.toString()}`;

  const data = await fetchJson(url);
  const r = data.result || {};
  if (data.status === "0" || data.message === "NOTOK") {
    if (!r || r === "" || typeof r !== "object") {
      throw new Error(`Gas oracle failed: ${data.message || data.result || "status 0"}`);
    }
  }
  const propose = r.ProposeGasPrice ?? r.proposeGasPrice;
  const fast = r.FastGasPrice ?? r.fastGasPrice;
  const safe = r.SafeGasPrice ?? r.safeGasPrice;
  if (propose === undefined && fast === undefined && safe === undefined) {
    throw new Error("Missing gas price fields from explorer");
  }
  const GAS_LIMIT = 21000;

  function mkTier(label, gwei, speedSec) {
    const g = Number(gwei);
    if (!Number.isFinite(g)) return { label, feeUSD: null, feeJPY: null, speedSec };
    if (!hasPrice) return { label, feeUSD: null, feeJPY: null, speedSec };
    const gasPriceToken = g * 1e-9;
    const feeToken = gasPriceToken * GAS_LIMIT;
    const feeUSD = feeToken * priceUsd;
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
  const LAMPORTS_PER_SIGNATURE = 5000;
  const signatures = 1;
  const lamports = LAMPORTS_PER_SIGNATURE * signatures;
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

// ---------- ARB (L2) ----------
async function buildArbitrum(prices) {
  return buildScanGasChain(prices.ETH, EXPLORER_CONFIGS.arb);
}

// ---------- OP (L2) ----------
async function buildOptimism(prices) {
  return buildScanGasChain(prices.ETH, EXPLORER_CONFIGS.op);
}

// ---------- Base (L2) ----------
async function buildBase(prices) {
  return buildScanGasChain(prices.ETH, EXPLORER_CONFIGS.base);
}

// ---------- Polygon ----------
async function buildPolygon(prices) {
  return buildScanGasChain(prices.MATIC, EXPLORER_CONFIGS.polygon);
}

// ---------- BSC ----------
async function buildBsc(prices) {
  return buildScanGasChain(prices.BNB, EXPLORER_CONFIGS.bsc);
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
      arb: await safeBuild(() => buildArbitrum(prices), generatedAt),
      op: await safeBuild(() => buildOptimism(prices), generatedAt),
      base: await safeBuild(() => buildBase(prices), generatedAt),
      polygon: await safeBuild(() => buildPolygon(prices), generatedAt),
      bsc: await safeBuild(() => buildBsc(prices), generatedAt),
    };

    return res.status(200).json({ generatedAt, chains });
  } catch (e) {
    console.error("[snapshot] fatal error:", e);
    const failedChains = {
      btc: baseFailedChain(generatedAt, e.message || "error"),
      eth: baseFailedChain(generatedAt, e.message || "error"),
      sol: baseFailedChain(generatedAt, e.message || "error"),
      arb: baseFailedChain(generatedAt, e.message || "error"),
      op: baseFailedChain(generatedAt, e.message || "error"),
      base: baseFailedChain(generatedAt, e.message || "error"),
      polygon: baseFailedChain(generatedAt, e.message || "error"),
      bsc: baseFailedChain(generatedAt, e.message || "error"),
    };
    return res.status(200).json({ generatedAt, chains: failedChains });
  }
};
