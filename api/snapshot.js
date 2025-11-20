// api/snapshot.js
// CryptoFeeScope snapshot API (BTC / ETH / SOL / ARB / OP) - CommonJS

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// ---------- 共通 ----------

async function fetchJson (url, options = {}) {
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

function decideStatus (feeUsd, speedSec) {
  const fee = Number(feeUsd) || 0;
  const s   = Number(speedSec) || 0;
  if (fee < 0.05 && s < 5 * 60) return "fast";
  if (fee > 1 || s > 60 * 60)   return "slow";
  return "avg";
}

async function safeBuild (builder) {
  try {
    return await builder();
  } catch (e) {
    console.error("[snapshot] chain failed:", e.message);
    const now = new Date().toISOString();
    return {
      feeUSD: null,
      speedSec: null,
      status: "avg",
      updated: now,
      tiers: [],
      error: e.message.slice(0, 200),
    };
  }
}

// ---------- 価格（USD） ----------

async function getUsdPrices () {
  const ids = ["bitcoin", "ethereum", "solana", "arbitrum", "optimism"];
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
  });

  const usePro  = !!COINGECKO_API_KEY;
  const baseUrl = usePro
    ? "https://pro-api.coingecko.com/api/v3/simple/price"
    : "https://api.coingecko.com/api/v3/simple/price";
  const headers = usePro ? { "x-cg-pro-api-key": COINGECKO_API_KEY } : {};

  try {
    const data = await fetchJson(`${baseUrl}?${params.toString()}`, { headers });
    return {
      BTC: data.bitcoin?.usd   ?? null,
      ETH: data.ethereum?.usd  ?? null,
      SOL: data.solana?.usd    ?? null,
      ARB: data.arbitrum?.usd  ?? null,
      OP:  data.optimism?.usd  ?? null,
    };
  } catch (e) {
    console.error("[snapshot] price fetch failed:", e.message);
    return { BTC: null, ETH: null, SOL: null, ARB: null, OP: null };
  }
}

// ---------- BTC ----------

async function buildBitcoin (prices) {
  const btcPrice = prices.BTC;
  if (!btcPrice) throw new Error("No BTC price");

  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
  const TX_VBYTES = 140;

  const tiersSrc = [
    { key: "fast",     label: "Fast (~10 min)",    feeRate: data.fastestFee,  speed: 10 * 60 },
    { key: "standard", label: "Normal (~30 min)",  feeRate: data.halfHourFee, speed: 30 * 60 },
    { key: "slow",     label: "Slow (~60 min)",    feeRate: data.hourFee,     speed: 60 * 60 },
  ];

  const tiers = tiersSrc.map(t => {
    const feeBtc = (t.feeRate * TX_VBYTES) / 1e8;
    const feeUsd = feeBtc * btcPrice;
    return {
      tier: t.key,
      label: t.label,
      gasPrice: t.feeRate,
      gasUnit: "sat/vB",
      txVbytes: TX_VBYTES,
      feeUSD: feeUsd,
      speedMinSec: t.speed,
      speedMaxSec: t.speed,
    };
  });

  const main = tiers.find(t => t.tier === "standard") || tiers[0] || null;
  const now  = new Date().toISOString();
  const feeMain   = main ? main.feeUSD      : null;
  const speedMain = main ? main.speedMinSec : null;

  return {
    feeUSD:  feeMain,
    speedSec: speedMain,
    status:  decideStatus(feeMain, speedMain),
    updated: now,
    tiers,
    priceUSD: btcPrice,
  };
}

// ---------- ETH ----------

async function buildEthereum (prices) {
  const ethPrice = prices.ETH;
  if (!ethPrice) throw new Error("No ETH price");
  if (!ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY not set");

  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    chainid: "1",
    apikey: ETHERSCAN_API_KEY,
  });

  const data = await fetchJson(`https://api.etherscan.io/v2/api?${params.toString()}`);
  if (!data.result) throw new Error("No gasoracle.result from Etherscan");

  const r = data.result;
  const GAS_LIMIT = 21000;

  function mkTier (key, gwei, label, speedSec) {
    const g = Number(gwei) || 0;
    const gasPriceEth = g * 1e-9;
    const feeEth = gasPriceEth * GAS_LIMIT;
    const feeUsd = feeEth * ethPrice;
    return {
      tier: key,
      label,
      gasPrice: g,
      gasUnit: "gwei",
      gasLimit: GAS_LIMIT,
      feeUSD: feeUsd,
      speedMinSec: speedSec,
      speedMaxSec: speedSec,
    };
  }

  const tiers = [
    mkTier("fast",     r.FastGasPrice,    "Fast (~30 sec)", 30),
    mkTier("standard", r.ProposeGasPrice, "Normal (~2 min)", 120),
    mkTier("slow",     r.SafeGasPrice,    "Slow (~5 min)",   300),
  ];

  const main = tiers.find(t => t.tier === "standard") || tiers[0] || null;
  const now  = new Date().toISOString();
  const feeMain   = main ? main.feeUSD      : null;
  const speedMain = main ? main.speedMinSec : null;

  return {
    feeUSD:  feeMain,
    speedSec: speedMain,
    status:  decideStatus(feeMain, speedMain),
    updated: now,
    tiers,
    priceUSD: ethPrice,
  };
}

// ---------- SOL ----------

async function buildSolana (prices) {
  const solPrice = prices.SOL;
  if (!solPrice) throw new Error("No SOL price");

  const LAMPORTS_PER_SIGNATURE = 5000;
  const signatures = 1;
  const lamports   = LAMPORTS_PER_SIGNATURE * signatures;
  const feeSol     = lamports / 1e9;
  const feeUsd     = feeSol * solPrice;
  const speed      = 10;

  const tier = {
    tier: "base",
    label: "Base fee (no priority)",
    lamports,
    lamportsPerSignature: LAMPORTS_PER_SIGNATURE,
    signatures,
    feeUSD: feeUsd,
    speedMinSec: speed,
    speedMaxSec: speed,
  };

  const now = new Date().toISOString();

  return {
    feeUSD:  feeUsd,
    speedSec: speed,
    status:  decideStatus(feeUsd, speed),
    updated: now,
    tiers: [tier],
    priceUSD: solPrice,
  };
}

// ---------- ARB (L2) ----------

async function buildArbitrum (prices) {
  const ethPrice = prices.ETH;
  if (!ethPrice) throw new Error("No ETH price for Arbitrum");

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

  function mkTier (key, multiplier, label, speedSec) {
    const g = gasPriceGwei * multiplier;
    const gasPriceEth = g * 1e-9;
    const feeEth = gasPriceEth * GAS_LIMIT;
    const feeUsd = feeEth * ethPrice;
    return {
      tier: key,
      label,
      gasPrice: g,
      gasUnit: "gwei (L2)",
      gasLimit: GAS_LIMIT,
      feeUSD: feeUsd,
      speedMinSec: speedSec,
      speedMaxSec: speedSec,
    };
  }

  const tiers = [
    mkTier("fast",     1.5, "Fast (~10 sec)", 10),
    mkTier("standard", 1.0, "Normal (~30 sec)", 30),
    mkTier("slow",     0.7, "Slow (~60 sec)", 60),
  ];

  const main = tiers.find(t => t.tier === "standard") || tiers[0] || null;
  const now  = new Date().toISOString();
  const feeMain   = main ? main.feeUSD      : null;
  const speedMain = main ? main.speedMinSec : null;

  return {
    feeUSD:  feeMain,
    speedSec: speedMain,
    status:  decideStatus(feeMain, speedMain),
    updated: now,
    tiers,
    priceUSD: ethPrice,
    note: "L2 internal transfer only; L1 settlement cost excluded.",
  };
}

// ---------- OP (L2) ----------

async function buildOptimism (prices) {
  const ethPrice = prices.ETH;
  if (!ethPrice) throw new Error("No ETH price for Optimism");

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

  function mkTier (key, multiplier, label, speedSec) {
    const g = gasPriceGwei * multiplier;
    const gasPriceEth = g * 1e-9;
    const feeEth = gasPriceEth * GAS_LIMIT;
    const feeUsd = feeEth * ethPrice;
    return {
      tier: key,
      label,
      gasPrice: g,
      gasUnit: "gwei (L2)",
      gasLimit: GAS_LIMIT,
      feeUSD: feeUsd,
      speedMinSec: speedSec,
      speedMaxSec: speedSec,
    };
  }

  const tiers = [
    mkTier("fast",     1.5, "Fast (~10 sec)", 10),
    mkTier("standard", 1.0, "Normal (~30 sec)", 30),
    mkTier("slow",     0.7, "Slow (~60 sec)", 60),
  ];

  const main = tiers.find(t => t.tier === "standard") || tiers[0] || null;
  const now  = new Date().toISOString();
  const feeMain   = main ? main.feeUSD      : null;
  const speedMain = main ? main.speedMinSec : null;

  return {
    feeUSD:  feeMain,
    speedSec: speedMain,
    status:  decideStatus(feeMain, speedMain),
    updated: now,
    tiers,
    priceUSD: ethPrice,
    note: "L2 internal transfer only; L1 settlement cost excluded.",
  };
}

// ---------- ハンドラ ----------

module.exports = async function (req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();

    const prices = await getUsdPrices();

    const snapshot = {};
    snapshot.bitcoin  = await safeBuild(() => buildBitcoin(prices));
    snapshot.ethereum = await safeBuild(() => buildEthereum(prices));
    snapshot.solana   = await safeBuild(() => buildSolana(prices));
    snapshot.arbitrum = await safeBuild(() => buildArbitrum(prices));
    snapshot.optimism = await safeBuild(() => buildOptimism(prices));

    return res.status(200).json(snapshot);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
