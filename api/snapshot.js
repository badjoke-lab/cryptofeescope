// api/snapshot.js
// CryptoFeeScope snapshot API (8 chains)

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
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

// ---------- safeBuild（★修正版） ----------
async function safeBuild(builder, generatedAt) {
  try {
    const result = await builder();
    return { ok: true, ...result };
  } catch (e) {
    console.error("[snapshot] chain failed:", e.message);
    const ts = generatedAt || new Date().toISOString();
    return baseFailedChain(ts, e.message || "error");
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
    return {
      BTC: data.bitcoin || {},
      ETH: data.ethereum || {},
      SOL: data.solana || {},
      ARB: data.arbitrum || {},
      OP: data.optimism || {},
      MATIC: data["matic-network"] || {},
      BNB: data.binancecoin || {},
    };
  } catch (e) {
    console.error("[snapshot] price fetch failed:", e.message);
    return { BTC: {}, ETH: {}, SOL: {}, ARB: {}, OP: {}, MATIC: {}, BNB: {} };
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

  const main = tiers.find(t => t.label === "standard") || tiers[0];
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

// ---------- ETH ----------
async function buildEthereum(prices) {
  const price = prices.ETH;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No ETH price");
  if (!ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY not set");

  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    apikey: ETHERSCAN_API_KEY,
  });

  return buildEtherscanGasChain(prices.ETH, `https://api.etherscan.io/api?${params.toString()}`);
}

// ---------- 共通: Etherscan 互換チェーン ----------
async function buildEtherscanGasChain(priceObj, url) {
  const priceUsd = Number(priceObj?.usd);
  if (!priceUsd) throw new Error("No token price for gas chain");
  if (!ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY not set");

  const data = await fetchJson(url);
  if (!data.result) throw new Error("No gasoracle.result");
  const r = data.result;
  const GAS_LIMIT = 21000;
  const usdToJpy = calcUsdToJpyRate(priceObj);

  function mkTier(label, gwei, speedSec) {
    const g = Number(gwei) || 0;
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
    mkTier("standard", r.ProposeGasPrice, 120),
    mkTier("fast", r.FastGasPrice, 30),
    mkTier("slow", r.SafeGasPrice, 300),
  ];

  // ★ main tier を standard に変更
  const main = tiers.find(t => t.label === "standard") || tiers[0];
  const now = new Date().toISOString();
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

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

// ---------- ARB ----------
async function buildArbitrum(prices) {
  const price = prices.ETH;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No ETH price for Arbitrum");

  const usdToJpy = calcUsdToJpyRate(price);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_gasPrice",
    params: [],
  });

  const rpc = await fetchJson("https://arb1.arbitrum.io/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const gasPriceWei = parseInt(rpc.result, 16);
  if (!Number.isFinite(gasPriceWei)) throw new Error("Invalid gasPrice from Arbitrum");

  const gasPriceGwei = gasPriceWei / 1e9;
  const GAS_LIMIT = 21000;

  function mkTier(label, multiplier, speedSec) {
    const g = gasPriceGwei * multiplier;
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
    mkTier("standard", 1.0, 30),
    mkTier("fast", 1.5, 10),
    mkTier("slow", 0.7, 60),
  ];

  const main = tiers[0];
  const now = new Date().toISOString();
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: now,
    tiers,
  };
}

// ---------- OP ----------
async function buildOptimism(prices) {
  const price = prices.ETH;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No ETH price for Optimism");

  const usdToJpy = calcUsdToJpyRate(price);

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_gasPrice",
    params: [],
  });

  const rpc = await fetchJson("https://mainnet.optimism.io", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const gasPriceWei = parseInt(rpc.result, 16);
  if (!Number.isFinite(gasPriceWei)) throw new Error("Invalid gasPrice from Optimism");

  const gasPriceGwei = gasPriceWei / 1e9;
  const GAS_LIMIT = 21000;

  function mkTier(label, multiplier, speedSec) {
    const g = gasPriceGwei * multiplier;
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
    mkTier("standard", 1.0, 30),
    mkTier("fast", 1.5, 10),
    mkTier("slow", 0.7, 60),
  ];

  const main = tiers[0];
  const now = new Date().toISOString();
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: now,
    tiers,
  };
}

// ---------- Base ----------
async function buildBase(prices) {
  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    apikey: ETHERSCAN_API_KEY,
  });
  return buildEtherscanGasChain(prices.ETH, `https://api.basescan.org/api?${params.toString()}`);
}

// ---------- Polygon ----------
async function buildPolygon(prices) {
  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    apikey: ETHERSCAN_API_KEY,
  });
  return buildEtherscanGasChain(prices.MATIC, `https://api.polygonscan.com/api?${params.toString()}`);
}

// ---------- BSC ----------
async function buildBsc(prices) {
  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    apikey: ETHERSCAN_API_KEY,
  });
  return buildEtherscanGasChain(prices.BNB, `https://api.bscscan.com/api?${params.toString()}`);
}

// ---------- ハンドラ（★chains に generatedAt を渡す） ----------
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
