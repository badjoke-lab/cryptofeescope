// api/snapshot.js
// CryptoFeeScope snapshot API (BTC / ETH / SOL) - CommonJS
// Etherscan V2 official format + rate-limit retry + low-gwei sanity check

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const BTC_TX_VBYTES = 140;   // standard p2wpkh send estimate
const ETH_GAS_LIMIT = 21000; // simple ETH transfer
const SOL_LAMPORTS_PER_SIGNATURE = 5000; // typical 1 sig tx

// -------------------- common --------------------

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

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

async function safeBuild(builder, generatedAt) {
  try {
    const result = await builder();
    return { ok: true, ...result };
  } catch (e) {
    console.error("[snapshot] chain failed:", e.message);
    return baseFailedChain(generatedAt, e.message || "error");
  }
}

// -------------------- prices (BTC/ETH/SOL only) --------------------

let LAST_PRICES = null;

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
    return LAST_PRICES || { BTC:{}, ETH:{}, SOL:{} };
  }
}

// -------------------- BTC --------------------

async function buildBitcoin(prices) {
  const price = prices.BTC;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No BTC price");

  const usdToJpy = calcUsdToJpyRate(price);
  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");

  const tiersSrc = [
    { label: "standard", feeRate: data.halfHourFee, speedSec: 30 * 60 },
    { label: "fast", feeRate: data.fastestFee, speedSec: 10 * 60 },
    { label: "slow", feeRate: data.hourFee, speedSec: 60 * 60 },
  ];

  const tiers = tiersSrc.map(t => {
    const feeBtc = (t.feeRate * BTC_TX_VBYTES) / 1e8;
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

// -------------------- ETH (Etherscan V2 gasoracle) --------------------

async function fetchEtherscanGasOracleV2() {
  if (!ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY not set");

  const params = new URLSearchParams({
    chainid: "1",
    module: "gastracker",
    action: "gasoracle",
    apikey: ETHERSCAN_API_KEY,
  });

  const url = `https://api.etherscan.io/v2/api?${params.toString()}`;

  // rate-limit safe retry (max 3)
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const data = await fetchJson(url);
      if (data?.status === "0" || data?.message === "NOTOK") {
        throw new Error(`Etherscan NOTOK: ${data?.result || data?.message}`);
      }
      if (!data?.result) throw new Error("Missing result from Etherscan gasoracle");
      return data.result;
    } catch (e) {
      lastErr = e;
      const backoff = 300 * Math.pow(2, i); // 300ms, 600ms, 1200ms
      await sleep(backoff);
    }
  }
  throw lastErr || new Error("Etherscan gasoracle failed");
}

async function buildEthereum(prices) {
  const price = prices.ETH;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No ETH price");

  const usdToJpy = calcUsdToJpyRate(price);
  const r = await fetchEtherscanGasOracleV2();

  const propose = r.ProposeGasPrice ?? r.proposeGasPrice;
  const fast = r.FastGasPrice ?? r.fastGasPrice;
  const safe = r.SafeGasPrice ?? r.safeGasPrice;

  if (propose == null && fast == null && safe == null) {
    throw new Error("Missing gas fields from Etherscan");
  }

  function mkTier(label, gwei, speedSec) {
    const g = Number(gwei);
    if (!Number.isFinite(g)) return { label, feeUSD: null, feeJPY: null, speedSec };

    // sanity check: mainnet gas < 1 gwei is almost certainly broken feed
    if (g < 1) {
      throw new Error(`Unrealistic gas price (${g} gwei) from Etherscan`);
    }

    const gasPriceEth = g * 1e-9;
    const feeEth = gasPriceEth * ETH_GAS_LIMIT;
    const feeUSD = feeEth * priceUsd;

    return {
      label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, usdToJpy),
      speedSec,
      gasPriceGwei: g,
      gasLimit: ETH_GAS_LIMIT,
    };
  }

  const tiers = [
    mkTier("standard", propose, 120),
    mkTier("fast", fast, 30),
    mkTier("slow", safe, 300),
  ];

  const main = tiers[0] || null;
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

// -------------------- SOL --------------------

async function buildSolana(prices) {
  const price = prices.SOL;
  const priceUsd = Number(price.usd);
  if (!priceUsd) throw new Error("No SOL price");

  const usdToJpy = calcUsdToJpyRate(price);
  const lamports = SOL_LAMPORTS_PER_SIGNATURE * 1;
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

// -------------------- handler --------------------

module.exports = async function(req, res) {
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
