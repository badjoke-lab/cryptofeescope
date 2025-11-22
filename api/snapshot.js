// api/snapshot.js
// CryptoFeeScope snapshot API (8 chains, single Etherscan API key)

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// ---------- Utils ----------
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

function baseFailedChain(nowIso, msg = "") {
  return {
    feeUSD: null,
    feeJPY: null,
    speedSec: null,
    status: "failed",
    updated: nowIso,
    ok: false,
    error: msg ? msg.slice(0, 200) : undefined,
    tiers: [
      { label: "standard", feeUSD: null, feeJPY: null, speedSec: null },
      { label: "fast", feeUSD: null, feeJPY: null, speedSec: null },
      { label: "slow", feeUSD: null, feeJPY: null, speedSec: null },
    ],
  };
}

async function safeBuild(builder, ts) {
  try {
    const r = await builder();
    return { ok: true, ...r };
  } catch (e) {
    return baseFailedChain(ts, e.message || "error");
  }
}

// ---------- Price fetch ----------
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
  } catch {
    return { BTC: {}, ETH: {}, SOL: {}, ARB: {}, OP: {}, MATIC: {}, BNB: {} };
  }
}

// ---------- BTC ----------
async function buildBitcoin(prices) {
  const p = prices.BTC;
  const usd = Number(p.usd);
  if (!usd) throw new Error("No BTC price");

  const rate = calcUsdToJpyRate(p);
  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
  const VBYTES = 140;

  const tiersSrc = [
    { label: "standard", feeRate: data.halfHourFee, speedSec: 1800 },
    { label: "fast", feeRate: data.fastestFee, speedSec: 600 },
    { label: "slow", feeRate: data.hourFee, speedSec: 3600 },
  ];

  const tiers = tiersSrc.map(t => {
    const feeBtc = (t.feeRate * VBYTES) / 1e8;
    const feeUSD = feeBtc * usd;
    return {
      label: t.label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, rate),
      speedSec: t.speedSec,
    };
  });

  const main = tiers.find(t => t.label === "standard");
  const now = new Date().toISOString();

  return {
    feeUSD: main.feeUSD,
    feeJPY: calcJpy(main.feeUSD, rate),
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: now,
    tiers,
  };
}

// ---------- Etherscan family builder ----------
async function buildEtherscanGasChain(priceObj, url) {
  const usd = Number(priceObj?.usd);
  if (!usd) throw new Error("No token price");

  const rate = calcUsdToJpyRate(priceObj);
  const data = await fetchJson(url);
  if (!data.result) throw new Error("No gasoracle.result");

  const r = data.result;
  const GAS_LIMIT = 21000;

  // invalid value guard
  const gFast = Number(r.FastGasPrice);
  const gProp = Number(r.ProposeGasPrice);
  const gSafe = Number(r.SafeGasPrice);

  if (![gFast, gProp, gSafe].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error("Invalid gas price from Etherscan chain");
  }

  function mk(label, gwei, sec) {
    const gasToken = gwei * 1e-9;
    const feeToken = gasToken * GAS_LIMIT;
    const feeUSD = feeToken * usd;
    return {
      label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, rate),
      speedSec: sec,
    };
  }

  const tiers = [
    mk("standard", gProp, 120),
    mk("fast", gFast, 30),
    mk("slow", gSafe, 300),
  ];

  const main = tiers[0];
  const now = new Date().toISOString();

  return {
    feeUSD: main.feeUSD,
    feeJPY: calcJpy(main.feeUSD, rate),
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: now,
    tiers,
  };
}

// ---------- SOL ----------
async function buildSolana(prices) {
  const p = prices.SOL;
  const usd = Number(p.usd);
  if (!usd) throw new Error("No SOL price");

  const rate = calcUsdToJpyRate(p);
  const lamports = 5000;
  const feeSol = lamports / 1e9;
  const feeUsd = feeSol * usd;

  const tiers = [
    { label: "standard", feeUSD: feeUsd, feeJPY: calcJpy(feeUsd, rate), speedSec: 10 },
    { label: "fast", feeUSD: feeUsd, feeJPY: calcJpy(feeUsd, rate), speedSec: 8 },
    { label: "slow", feeUSD: feeUsd, feeJPY: calcJpy(feeUsd, rate), speedSec: 20 },
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

// ---------- L2 ----------
async function buildArbitrum(prices) {
  const p = prices.ETH;
  const usd = Number(p.usd);
  if (!usd) throw new Error("No ETH price");

  const rate = calcUsdToJpyRate(p);

  const rpc = await fetchJson("https://arb1.arbitrum.io/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_gasPrice",
      params: [],
    }),
  });

  const wei = parseInt(rpc.result, 16);
  if (!Number.isFinite(wei) || wei <= 0) throw new Error("Invalid gasPrice");

  const gwei = wei / 1e9;
  const GAS = 21000;

  function mk(label, mul, sec) {
    const gasGwei = gwei * mul;
    const feeToken = gasGwei * 1e-9 * GAS;
    const feeUSD = feeToken * usd;
    return {
      label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, rate),
      speedSec: sec,
    };
  }

  const tiers = [
    mk("standard", 1.0, 30),
    mk("fast", 1.5, 10),
    mk("slow", 0.7, 60),
  ];

  const main = tiers[0];
  const now = new Date().toISOString();

  return {
    feeUSD: main.feeUSD,
    feeJPY: calcJpy(main.feeUSD, rate),
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: now,
    tiers,
  };
}

async function buildOptimism(prices) {
  const p = prices.ETH;
  const usd = Number(p.usd);
  if (!usd) throw new Error("No ETH price");

  const rate = calcUsdToJpyRate(p);

  const rpc = await fetchJson("https://mainnet.optimism.io", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_gasPrice",
      params: [],
    }),
  });

  const wei = parseInt(rpc.result, 16);
  if (!Number.isFinite(wei) || wei <= 0) throw new Error("Invalid gasPrice");

  const gwei = wei / 1e9;
  const GAS = 21000;

  function mk(label, mul, sec) {
    const gasGwei = gwei * mul;
    const feeToken = gasGwei * 1e-9 * GAS;
    const feeUSD = feeToken * usd;
    return {
      label,
      feeUSD,
      feeJPY: calcJpy(feeUSD, rate),
      speedSec: sec,
    };
  }

  const tiers = [
    mk("standard", 1.0, 30),
    mk("fast", 1.5, 10),
    mk("slow", 0.7, 60),
  ];

  const main = tiers[0];
  const now = new Date().toISOString();

  return {
    feeUSD: main.feeUSD,
    feeJPY: calcJpy(main.feeUSD, rate),
    speedSec: main.speedSec,
    status: decideStatus(main.feeUSD, main.speedSec),
    updated: now,
    tiers,
  };
}

// ---------- Base / Polygon / BSC（全部 Etherscan API Key 1個でOK） ----------
async function buildBase(prices) {
  return buildEtherscanGasChain(
    prices.ETH,
    `https://api.basescan.org/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`
  );
}

async function buildPolygon(prices) {
  return buildEtherscanGasChain(
    prices.MATIC,
    `https://api.polygonscan.com/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`
  );
}

async function buildBsc(prices) {
  return buildEtherscanGasChain(
    prices.BNB,
    `https://api.bscscan.com/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`
  );
}

// ---------- Handler ----------
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const ts = new Date().toISOString();

  try {
    const prices = await getPrices();

    const chains = {
      btc: await safeBuild(() => buildBitcoin(prices), ts),
      eth: await safeBuild(() => buildEthereum(prices), ts),
      sol: await safeBuild(() => buildSolana(prices), ts),
      arb: await safeBuild(() => buildArbitrum(prices), ts),
      op:  await safeBuild(() => buildOptimism(prices), ts),
      base: await safeBuild(() => buildBase(prices), ts),
      polygon: await safeBuild(() => buildPolygon(prices), ts),
      bsc: await safeBuild(() => buildBsc(prices), ts),
    };

    return res.status(200).json({ generatedAt: ts, chains });
  } catch (e) {
    const failed = id => baseFailedChain(ts, e.message || "error");
    return res.status(200).json({
      generatedAt: ts,
      chains: {
        btc: failed("btc"),
        eth: failed("eth"),
        sol: failed("sol"),
        arb: failed("arb"),
        op: failed("op"),
        base: failed("base"),
        polygon: failed("polygon"),
        bsc: failed("bsc"),
      },
    });
  }
};
