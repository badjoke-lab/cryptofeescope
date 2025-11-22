// api/snapshot.js
// CryptoFeeScope snapshot API (8 chains)
// Source policy: prefer official/public RPCs, no per-chain scan keys required.

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

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

// JSON-RPC helper
async function fetchRpc(rpcUrl, method, params = []) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  const data = await fetchJson(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  return data;
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
async function buildBitcoin(prices, generatedAt) {
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
  const feeUSD = main ? main.feeUSD : null;
  const speedSec = main ? main.speedSec : null;

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: generatedAt,
    tiers,
  };
}

// ---------- 共通: EVM RPC Gas Chains ----------
async function buildEvmRpcGasChain({
  priceObj,
  rpcUrl,
  label,
  generatedAt,
  gasLimit = 21000,
  tiersConfig = {
    standard: { mult: 1.0, speedSec: 120 },
    fast: { mult: 1.5, speedSec: 30 },
    slow: { mult: 0.7, speedSec: 300 },
  },
}) {
  const priceUsd = Number(priceObj?.usd);
  if (!priceUsd) throw new Error(`No token price for ${label}`);

  const usdToJpy = calcUsdToJpyRate(priceObj);

  const rpc = await fetchRpc(rpcUrl, "eth_gasPrice");
  const gasPriceWei = parseInt(rpc.result, 16);
  if (!Number.isFinite(gasPriceWei) || gasPriceWei <= 0) {
    throw new Error(`Invalid gasPrice from ${label} RPC`);
  }

  const gasPriceGwei = gasPriceWei / 1e9;

  function mkTier(labelName, mult, speedSec) {
    const g = gasPriceGwei * mult;
    const gasPriceToken = g * 1e-9;          // token per gas
    const feeToken = gasPriceToken * gasLimit;
    const feeUSD = feeToken * priceUsd;
    return {
      label: labelName,
      feeUSD,
      feeJPY: calcJpy(feeUSD, usdToJpy),
      speedSec,
    };
  }

  const tiers = [
    mkTier("standard", tiersConfig.standard.mult, tiersConfig.standard.speedSec),
    mkTier("fast", tiersConfig.fast.mult, tiersConfig.fast.speedSec),
    mkTier("slow", tiersConfig.slow.mult, tiersConfig.slow.speedSec),
  ];

  const main = tiers.find(t => t.label === "standard") || tiers[0] || null;
  const feeUSD = main ? main.feeUSD : null;
  const speedSec = main ? main.speedSec : null;

  return {
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
    status: decideStatus(feeUSD, speedSec),
    updated: generatedAt,
    tiers,
  };
}

// ---------- ETH ----------
async function buildEthereum(prices, generatedAt) {
  return buildEvmRpcGasChain({
    priceObj: prices.ETH,
    rpcUrl: "https://cloudflare-eth.com",
    label: "ETH",
    generatedAt,
    gasLimit: 21000,
    tiersConfig: {
      standard: { mult: 1.0, speedSec: 120 },
      fast: { mult: 1.5, speedSec: 30 },
      slow: { mult: 0.7, speedSec: 300 },
    },
  });
}

// ---------- SOL ----------
async function buildSolana(prices, generatedAt) {
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

  return {
    feeUSD: main.feeUSD,
    feeJPY: main.feeJPY,
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: generatedAt,
    tiers,
  };
}

// ---------- ARB (L2) ----------
async function buildArbitrum(prices, generatedAt) {
  // Use ETH price, RPC gasPrice from Arbitrum.
  return buildEvmRpcGasChain({
    priceObj: prices.ETH,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    label: "ARB",
    generatedAt,
    gasLimit: 21000,
    tiersConfig: {
      standard: { mult: 1.0, speedSec: 30 },
      fast: { mult: 1.5, speedSec: 10 },
      slow: { mult: 0.7, speedSec: 60 },
    },
  });
}

// ---------- OP (L2) ----------
async function buildOptimism(prices, generatedAt) {
  return buildEvmRpcGasChain({
    priceObj: prices.ETH,
    rpcUrl: "https://mainnet.optimism.io",
    label: "OP",
    generatedAt,
    gasLimit: 21000,
    tiersConfig: {
      standard: { mult: 1.0, speedSec: 30 },
      fast: { mult: 1.5, speedSec: 10 },
      slow: { mult: 0.7, speedSec: 60 },
    },
  });
}

// ---------- Base (L2) ----------
async function buildBase(prices, generatedAt) {
  return buildEvmRpcGasChain({
    priceObj: prices.ETH,
    rpcUrl: "https://mainnet.base.org",
    label: "BASE",
    generatedAt,
    gasLimit: 21000,
    tiersConfig: {
      standard: { mult: 1.0, speedSec: 30 },
      fast: { mult: 1.5, speedSec: 10 },
      slow: { mult: 0.7, speedSec: 60 },
    },
  });
}

// ---------- Polygon ----------
async function buildPolygon(prices, generatedAt) {
  return buildEvmRpcGasChain({
    priceObj: prices.MATIC,
    rpcUrl: "https://polygon-rpc.com",
    label: "POLYGON",
    generatedAt,
    gasLimit: 21000,
    tiersConfig: {
      standard: { mult: 1.0, speedSec: 30 },
      fast: { mult: 1.5, speedSec: 10 },
      slow: { mult: 0.7, speedSec: 60 },
    },
  });
}

// ---------- BSC ----------
async function buildBsc(prices, generatedAt) {
  return buildEvmRpcGasChain({
    priceObj: prices.BNB,
    rpcUrl: "https://bsc-dataseed.binance.org",
    label: "BSC",
    generatedAt,
    gasLimit: 21000,
    tiersConfig: {
      standard: { mult: 1.0, speedSec: 30 },
      fast: { mult: 1.5, speedSec: 10 },
      slow: { mult: 0.7, speedSec: 60 },
    },
  });
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
      btc: await safeBuild(() => buildBitcoin(prices, generatedAt), generatedAt),
      eth: await safeBuild(() => buildEthereum(prices, generatedAt), generatedAt),
      sol: await safeBuild(() => buildSolana(prices, generatedAt), generatedAt),
      arb: await safeBuild(() => buildArbitrum(prices, generatedAt), generatedAt),
      op: await safeBuild(() => buildOptimism(prices, generatedAt), generatedAt),
      base: await safeBuild(() => buildBase(prices, generatedAt), generatedAt),
      polygon: await safeBuild(() => buildPolygon(prices, generatedAt), generatedAt),
      bsc: await safeBuild(() => buildBsc(prices, generatedAt), generatedAt),
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
