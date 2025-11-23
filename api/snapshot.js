// api/snapshot.js
// Reliability-first snapshot API with per-chain caching, last_good fallbacks,
// Etherscan v2 + per-chain gas oracles, anomaly rejection, and rate limiting.

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

// ---- Etherscan v2 / scan-v2 base URLs ----
// v2 endpoints (per docs). Each chain uses its own v2 host and chainid.
const EXPLORER_V2 = {
  eth: {
    baseUrl: "https://api.etherscan.io/v2/api",
    chainid: "1",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  arb: {
    baseUrl: "https://api.arbiscan.io/v2/api",
    chainid: "42161",
    apiKey: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  op: {
    baseUrl: "https://api-optimistic.etherscan.io/v2/api",
    chainid: "10",
    apiKey: process.env.OPTIMISTIC_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  base: {
    baseUrl: "https://api.basescan.org/v2/api",
    chainid: "8453",
    apiKey: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  polygon: {
    baseUrl: "https://api.polygonscan.com/v2/api",
    chainid: "137",
    apiKey: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  bsc: {
    baseUrl: "https://api.bscscan.com/v2/api",
    chainid: "56",
    apiKey: process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
  avax: {
    baseUrl: "https://api.snowtrace.io/v2/api",
    chainid: "43114",
    apiKey: process.env.SNOWTRACE_API_KEY || process.env.ETHERSCAN_API_KEY || "",
  },
};

const TTL_GLOBAL_MS = 60_000;
const DEFAULT_USD_TO_JPY = 150;

let LAST_SNAPSHOT = null;
let LAST_AT = 0;
let LAST_PRICES = null;
let LAST_GOOD_CHAINS = {};

// ---- Per-chain TTL ----
const CHAIN_TTL_MS = {
  btc: 60_000,
  eth: 60_000,
  sol: 60_000,
  arb: 90_000,
  op: 90_000,
  base: 90_000,
  polygon: 120_000,
  bsc: 120_000,
  avax: 120_000,
  default: 180_000,
};

function getChainTTL(chainId) {
  return CHAIN_TTL_MS[chainId] ?? CHAIN_TTL_MS.default;
}

// ---- Price IDs for Coingecko ----
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
  XRP: "ripple",
};

// ---- Fallback token prices (only used if zero cached) ----
const FALLBACK_TOKEN_PRICE_USD = {
  ETH: 1800,
  ARB: 1.2,
  OP: 1.2,
  BASE: 1800,
  POLYGON: 0.7,
  BSC: 230,
  AVAX: 30,
  XRP: 0.5,
};

// ---- Fallback gas (gwei) ----
const FALLBACK_GAS = { safe: 10, propose: 12, fast: 15 };

// ---- Gas limit for simple transfer ----
const GAS_LIMIT = 21_000;

// ---- Anomaly caps (simple transfer fee upper bounds) ----
// If live fee exceeds cap, we refuse to cache it (throw => cached/fallback used)
const ANOMALY_CAP_USD = {
  eth: 25,      // ETH can spike, but not hundreds for a simple transfer
  arb: 1.0,     // ARB simple transfer usually cents
  op: 1.0,      // OP simple transfer usually cents
  base: 1.0,    // BASE simple transfer usually cents
  polygon: 1.0,
  bsc: 1.0,
  avax: 2.0,
};

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

function asNumberMaybe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function safeCandidate(meta, fn) {
  const base = typeof meta === "string" ? { provider: meta } : meta;
  try {
    const value = await fn();
    const num = asNumberMaybe(value);
    return { ...base, value: num, ok: Number.isFinite(num) };
  } catch (e) {
    return {
      ...base,
      value: null,
      ok: false,
      error: e?.message || String(e),
    };
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res.text();
  } finally {
    clearTimeout(timer);
  }
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

function chainWithSource(data, source, staleSec) {
  return { ...data, source, staleSec };
}

// ---------------- Prices (Coingecko) ----------------
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

// ---------------- Etherscan v2 gas oracle (per chain) ----------------
async function fetchGasOracleV2(cfg) {
  const params = new URLSearchParams({
    chainid: cfg.chainid,
    module: "gastracker",
    action: "gasoracle",
  });
  if (cfg.apiKey) params.set("apikey", cfg.apiKey);

  const url = `${cfg.baseUrl}?${params.toString()}`;
  const data = await fetchJson(url);
  const r = data.result || {};

  if (data.status === "0" || data.message === "NOTOK") {
    throw new Error(`Gas oracle failed: ${data.message || data.result || "status 0"}`);
  }

  const propose = Number(r.ProposeGasPrice ?? r.proposeGasPrice);
  const fast = Number(r.FastGasPrice ?? r.fastGasPrice);
  const safe = Number(r.SafeGasPrice ?? r.safeGasPrice);

  const valid = [propose, fast, safe].every(v => Number.isFinite(v) && v > 0);
  if (!valid) throw new Error("Invalid gas price values from explorer v2");

  return { propose, fast, safe };
}

function mkEvmTier(label, gwei, speedSec, priceUsd, usdToJpy, gasLimit) {
  const g = Number(gwei);
  const price = Number(priceUsd);
  const hasPrice = Number.isFinite(price) && price > 0;

  const gasPriceEth = Number.isFinite(g) ? g * 1e-9 : null;
  const feeEth = gasPriceEth !== null ? gasPriceEth * gasLimit : null;
  const feeUSD = feeEth !== null && hasPrice ? feeEth * price : null;

  return {
    label,
    feeUSD,
    feeJPY: calcJpy(feeUSD, usdToJpy),
    speedSec,
  };
}

function buildEvmTiers(gas, priceUsd, usdToJpy) {
  return [
    mkEvmTier("standard", gas.propose, 120, priceUsd, usdToJpy, GAS_LIMIT),
    mkEvmTier("fast", gas.fast, 30, priceUsd, usdToJpy, GAS_LIMIT),
    mkEvmTier("slow", gas.safe, 300, priceUsd, usdToJpy, GAS_LIMIT),
  ];
}

function evmPrice(chainKey, prices) {
  const upper = chainKey.toUpperCase();
  if (upper === "BASE") return prices.ETH || {};
  return prices[upper] || {};
}

async function buildEvmChain(chainKey, ctx) {
  const generatedAt = ctx.generatedAt;
  const prices = ctx.prices;

  const priceObj = evmPrice(chainKey, prices);
  const priceUsd = Number(priceObj.usd);
  const usdToJpy = calcUsdToJpyRate(priceObj);

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`No ${chainKey} price`);
  }

  const cfg = EXPLORER_V2[chainKey];
  if (!cfg) throw new Error(`No explorer config for ${chainKey}`);

  const gas = await fetchGasOracleV2(cfg);
  const tiers = buildEvmTiers(gas, priceUsd, usdToJpy);

  const main = tiers[0];
  const feeUSD = main.feeUSD;
  const speedSec = main.speedSec;

  if (!Number.isFinite(feeUSD) || !Number.isFinite(speedSec)) {
    throw new Error(`Invalid ${chainKey} fee data`);
  }

  // ---- anomaly rejection (do NOT cache garbage) ----
  const cap = ANOMALY_CAP_USD[chainKey];
  if (Number.isFinite(cap) && feeUSD > cap) {
    throw new Error(`${chainKey} anomalous feeUSD=${feeUSD} > cap=${cap} (refuse cache)`);
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

// ---------------- BTC ----------------
async function buildBitcoin(ctx) {
  const generatedAt = ctx.generatedAt;
  const prices = ctx.prices;

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
    updated: generatedAt,
    tiers,
    ok: true,
  };
}

async function fallbackBitcoin(ctx) {
  const generatedAt = ctx.generatedAt;
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

// ---------------- SOL ----------------
async function buildSolana(ctx) {
  const generatedAt = ctx.generatedAt;
  const prices = ctx.prices;

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

async function fallbackSolana(ctx) {
  const generatedAt = ctx.generatedAt;
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

// ---------------- Test helpers: fee/speed candidates ----------------
const RPC_ENDPOINTS = {
  eth: "https://rpc.ankr.com/eth",
  bsc: "https://bsc-dataseed.binance.org",
  polygon: "https://polygon-rpc.com",
  avax: "https://api.avax.network/ext/bc/C/rpc",
  arb: "https://arb1.arbitrum.io/rpc",
  op: "https://mainnet.optimism.io",
  base: "https://mainnet.base.org",
};

async function fetchRpc(chain, method, params = []) {
  const url = RPC_ENDPOINTS[chain];
  if (!url) throw new Error(`No RPC endpoint for ${chain}`);
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res || res.error) throw new Error(res?.error?.message || "RPC error");
  return res.result;
}

function hexToNumber(hex) {
  if (typeof hex !== "string") return null;
  return parseInt(hex, 16);
}

function symbolForChain(chain) {
  const map = {
    btc: "BTC",
    eth: "ETH",
    bsc: "BSC",
    polygon: "POLYGON",
    avax: "AVAX",
    arb: "ARB",
    op: "OP",
    base: "BASE",
    sol: "SOL",
    xrp: "XRP",
  };
  return map[chain];
}

async function getTestPriceUSD(chain) {
  const symbol = symbolForChain(chain);
  if (!symbol) return null;
  const prices = await getPrices();
  const p = prices?.[symbol]?.usd;
  if (Number.isFinite(p)) return p;
  return FALLBACK_TOKEN_PRICE_USD[symbol] || null;
}

function calcGasUsd(gwei, gasLimit, priceUsd) {
  if (!Number.isFinite(gwei) || !Number.isFinite(gasLimit) || !Number.isFinite(priceUsd)) return null;
  const ethFee = (gwei / 1e9) * gasLimit;
  return ethFee * priceUsd;
}

function calcBtcUsd(satPerVb, vbytes, priceUsd) {
  if (!Number.isFinite(satPerVb) || !Number.isFinite(vbytes) || !Number.isFinite(priceUsd)) return null;
  const btc = (satPerVb * vbytes) / 1e8;
  return btc * priceUsd;
}

function calcSolUsd(lamports, signatures, priceUsd) {
  if (!Number.isFinite(lamports) || !Number.isFinite(priceUsd)) return null;
  const totalLamports = signatures ? lamports * signatures : lamports;
  return (totalLamports / 1e9) * priceUsd;
}

function calcXrpUsd(feeXrp, priceUsd) {
  if (!Number.isFinite(feeXrp) || !Number.isFinite(priceUsd)) return null;
  return feeXrp * priceUsd;
}

async function getEvmFeeCandidates(chain) {
  const cfg = EXPLORER_V2[chain];
  const candidates = [];
  const priceUsd = await getTestPriceUSD(chain);

  const gasPriceRpc = await safeCandidate(
    {
      provider: "rpc",
      type: "gasPrice-wei",
      logicId: "evm_fee_logic:gasprice_raw_gwei",
      sourceId: "rpc/gasPrice-wei",
    },
    async () => {
      const res = await fetchRpc(chain, "eth_gasPrice", []);
      return hexToNumber(res) / 1e9;
    }
  );

  const feeHistoryBase = await safeCandidate(
    {
      provider: "rpc",
      type: "feeHistory-base",
      logicId: "evm_fee_logic:basefee_last",
      sourceId: "rpc/feeHistory-base",
    },
    async () => {
      const res = await fetchRpc(chain, "eth_feeHistory", [2, "latest", []]);
      const base = Array.isArray(res?.baseFeePerGas)
        ? hexToNumber(res.baseFeePerGas.slice(-1)[0])
        : null;
      return base !== null ? base / 1e9 : null;
    }
  );

  const gasOraclePropose = cfg
    ? await safeCandidate(
        {
          provider: "scan-v2",
          type: "gasoracle-propose",
          logicId: "evm_fee_logic:oracle_propose",
          sourceId: "scan-v2/gasoracle-propose",
        },
        async () => {
          const r = await fetchGasOracleV2(cfg);
          return r.propose;
        }
      )
    : null;

  const gasOracleFast = cfg
    ? await safeCandidate(
        {
          provider: "scan-v2",
          type: "gasoracle-fast",
          logicId: "evm_fee_logic:oracle_fast",
          sourceId: "scan-v2/gasoracle-fast",
        },
        async () => {
          const r = await fetchGasOracleV2(cfg);
          return r.fast;
        }
      )
    : null;

  const scanGasPrice = cfg
    ? await safeCandidate(
        {
          provider: "scan-v2",
          type: "gasprice",
          logicId: "evm_fee_logic:scan_gasprice",
          sourceId: "scan-v2/proxy-gasprice",
        },
        async () => {
          const params = new URLSearchParams({ module: "proxy", action: "eth_gasPrice" });
          if (cfg.apiKey) params.set("apikey", cfg.apiKey);
          const data = await fetchJson(`${cfg.baseUrl}?${params.toString()}`);
          const val = hexToNumber(data?.result);
          return val ? val / 1e9 : null;
        }
      )
    : null;

  const scanFeeHistory = cfg
    ? await safeCandidate(
        {
          provider: "scan-v2",
          type: "feehistory",
          logicId: "evm_fee_logic:scan_feehistory",
          sourceId: "scan-v2/feehistory",
        },
        async () => {
          const params = new URLSearchParams({
            module: "gastracker",
            action: "feehistory",
            chainid: cfg.chainid,
          });
          if (cfg.apiKey) params.set("apikey", cfg.apiKey);
          const data = await fetchJson(`${cfg.baseUrl}?${params.toString()}`);
          const base = Array.isArray(data?.result?.baseFeePerGas)
            ? Number(data.result.baseFeePerGas[0])
            : null;
          return base;
        }
      )
    : null;

  const baseCandidates = [gasPriceRpc, feeHistoryBase, gasOraclePropose, gasOracleFast, scanGasPrice, scanFeeHistory].filter(
    Boolean
  );

  const assumePriority = [1, 1.5, 2];
  const gasLimits = [
    { label: "transfer", value: 21_000 },
    { label: "erc20", value: 65_000 },
  ];

  for (const base of baseCandidates) {
    for (const gl of gasLimits) {
      candidates.push(
        await safeCandidate(
          {
            provider: base.provider,
            type: `${base.type}-${gl.label}-gasprice`,
            logicId: `evm_fee_logic:${gl.label}_${gl.value}_gasprice`,
            sourceId: base.sourceId,
            assumptions: { gasLimit: gl.value, pricing: "legacy" },
          },
          async () => calcGasUsd(base.value, gl.value, priceUsd)
        )
      );
    }

    for (const tip of assumePriority) {
      candidates.push(
        await safeCandidate(
          {
            provider: base.provider,
            type: `${base.type}-1559-transfer-tip-${tip}`,
            logicId: `evm_fee_logic:transfer_21000_basefee_plus_priority_${tip}`,
            sourceId: base.sourceId,
            assumptions: { gasLimit: 21_000, priorityFeeGwei: tip, pricing: "1559" },
          },
          async () => (base.value !== null ? calcGasUsd(base.value + tip, 21_000, priceUsd) : null)
        )
      );
    }
  }

  // L2 specific additional candidates (include/exclude L1 data)
  if (["arb", "op", "base"].includes(chain)) {
    const l1DataGas = chain === "arb" ? 16_000 : 20_000;
    const l1Premium = chain === "arb" ? 1.5 : 1;
    const l1GasPriceGwei = feeHistoryBase?.value || gasPriceRpc?.value;

    candidates.push(
      await safeCandidate(
        {
          provider: "l2-synthetic",
          type: "l2-transfer-no-l1",
          logicId: "l2_fee_logic:transfer_l2_only",
          sourceId: "rpc/gasPrice-wei",
          assumptions: { includeL1: false, gasLimit: 21_000 },
        },
        async () => calcGasUsd(gasPriceRpc?.value, 21_000, priceUsd)
      )
    );

    candidates.push(
      await safeCandidate(
        {
          provider: "l2-synthetic",
          type: "l2-transfer-with-l1",
          logicId: "l2_fee_logic:transfer_with_l1_data",
          sourceId: "rpc/gasPrice-wei + estimate",
          assumptions: { includeL1: true, l1DataGas, l1Pricing: "estimated" },
        },
        async () => {
          if (!Number.isFinite(l1GasPriceGwei)) return null;
          const l2 = calcGasUsd(gasPriceRpc?.value, 21_000, priceUsd);
          const l1 = calcGasUsd(l1GasPriceGwei * l1Premium, l1DataGas, priceUsd);
          if (!Number.isFinite(l2) || !Number.isFinite(l1)) return null;
          return l1 + l2;
        }
      )
    );
  }

  candidates.push({
    provider: "blocknative",
    type: "gas",
    logicId: "blocknative",
    sourceId: "blocknative",
    value: null,
    ok: false,
    error: "API key not set",
  });

  return candidates;
}

async function getBitcoinFeeCandidates() {
  const candidates = [];
  const priceUsd = await getTestPriceUSD("btc");

  const mempoolRecommended = await safeCandidate(
    {
      provider: "mempool.space",
      type: "recommended",
      logicId: "btc_fee_logic:mempool_halfhour_sats",
      sourceId: "mempool/fees-recommended",
    },
    async () => {
      const d = await fetchJson("https://mempool.space/api/v1/fees/recommended");
      return d?.halfHourFee;
    }
  );

  const mempoolMinimum = await safeCandidate(
    {
      provider: "mempool.space",
      type: "minimum",
      logicId: "btc_fee_logic:mempool_minimum_sats",
      sourceId: "mempool/fees-recommended",
    },
    async () => {
      const d = await fetchJson("https://mempool.space/api/v1/fees/recommended");
      return d?.minimumFee;
    }
  );

  const mempoolFastest = await safeCandidate(
    {
      provider: "mempool.space",
      type: "fastest",
      logicId: "btc_fee_logic:mempool_fastest_sats",
      sourceId: "mempool/fees-recommended",
    },
    async () => {
      const d = await fetchJson("https://mempool.space/api/v1/fees/recommended");
      return d?.fastestFee;
    }
  );

  const blockstream1 = await safeCandidate(
    {
      provider: "blockstream.info",
      type: "estimatesmartfee-1",
      logicId: "btc_fee_logic:blockstream_1",
      sourceId: "blockstream/fee-estimates",
    },
    async () => {
      const d = await fetchJson("https://blockstream.info/api/fee-estimates");
      return d?.["1"];
    }
  );

  const blockstream6 = await safeCandidate(
    {
      provider: "blockstream.info",
      type: "estimatesmartfee-6",
      logicId: "btc_fee_logic:blockstream_6",
      sourceId: "blockstream/fee-estimates",
    },
    async () => {
      const d = await fetchJson("https://blockstream.info/api/fee-estimates");
      return d?.["6"];
    }
  );

  const mempoolBlocks = await safeCandidate(
    {
      provider: "mempool.space",
      type: "block-1",
      logicId: "btc_fee_logic:mempool_block1",
      sourceId: "mempool/fee-estimates",
    },
    async () => {
      const d = await fetchJson("https://mempool.space/api/v1/fee-estimates");
      return d?.["1"];
    }
  );

  const satCandidates = [
    mempoolRecommended,
    mempoolMinimum,
    mempoolFastest,
    blockstream1,
    blockstream6,
    mempoolBlocks,
  ];

  const vbyteAssumptions = [140, 225, 250, 400];
  for (const sat of satCandidates) {
    for (const vb of vbyteAssumptions) {
      candidates.push(
        await safeCandidate(
          {
            provider: sat.provider,
            type: `${sat.type}-v${vb}`,
            logicId: `btc_fee_logic:${sat.type}_vbytes_${vb}`,
            sourceId: sat.sourceId,
            assumptions: { vbytes: vb },
          },
          async () => calcBtcUsd(sat.value, vb, priceUsd)
        )
      );
    }
  }

  return candidates;
}

async function getSolanaFeeCandidates() {
  const candidates = [];
  const priceUsd = await getTestPriceUSD("sol");
  const endpoint = "https://api.mainnet-beta.solana.com";

  const baseLamports = await safeCandidate(
    {
      provider: "solana-rpc",
      type: "base-fee",
      logicId: "sol_fee_logic:lamports_per_sig",
      sourceId: "solana/getFees",
      assumptions: { signatures: 1 },
    },
    async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getFees", params: [] }),
      });
      const lamports = res?.value?.feeCalculator?.lamportsPerSignature;
      return lamports ? calcSolUsd(lamports, 1, priceUsd) : null;
    }
  );
  candidates.push(baseLamports);

  const prioritized = await safeCandidate(
    {
      provider: "solana-rpc",
      type: "getPrioritizationFee",
      logicId: "sol_fee_logic:prioritization_fee_per_sig",
      sourceId: "solana/getRecentPrioritizationFees",
      assumptions: { signatures: 1 },
    },
    async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getRecentPrioritizationFees",
          params: [["11111111111111111111111111111111"]],
        }),
      });
      const val = Array.isArray(res?.result) && res.result.length > 0 ? res.result[0].prioritizationFee : null;
      return val ? calcSolUsd(val, 1, priceUsd) : null;
    }
  );
  candidates.push(prioritized);

  candidates.push(
    await safeCandidate(
      {
        provider: "solscan",
        type: "latest-tx-average",
        logicId: "sol_fee_logic:solscan_avg",
        sourceId: "solscan/chaininfo",
        assumptions: { avgTx: true },
      },
      async () => {
        const d = await fetchJson("https://api.solscan.io/chaininfo");
        const lamports = d?.data?.txAvgFee;
        return lamports ? calcSolUsd(lamports, 1, priceUsd) : null;
      }
    )
  );
  return candidates;
}

async function getXrpFeeCandidates() {
  const endpoint = "https://s1.ripple.com:51234/";
  const candidates = [];
  const priceUsd = await getTestPriceUSD("xrp");
  candidates.push(
    await safeCandidate(
      {
        provider: "rippled",
        type: "base-fee",
        logicId: "xrp_fee_logic:base_fee",
        sourceId: "rippled/server_info",
        assumptions: { loadAdjusted: false },
      },
      async () => {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "server_info", params: [{}] }),
        });
        const fee = res?.result?.info?.validated_ledger?.base_fee_xrp;
        return calcXrpUsd(fee, priceUsd);
      }
    )
  );
  candidates.push(
    await safeCandidate(
      {
        provider: "rippled",
        type: "load-adjusted",
        logicId: "xrp_fee_logic:load_adjusted",
        sourceId: "rippled/server_state",
        assumptions: { loadAdjusted: true },
      },
      async () => {
        const res = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "server_state", params: [{}] }),
        });
        const base = res?.result?.state?.validated_ledger?.base_fee_xrp;
        const factor = res?.result?.state?.load_factor ?? 1;
        return calcXrpUsd(Number(base) * Number(factor), priceUsd);
      }
    )
  );

  candidates.push(
    await safeCandidate(
      {
        provider: "xrpscan",
        type: "current-fee",
        logicId: "xrp_fee_logic:xrpscan_base_fee",
        sourceId: "xrpscan/network/fees",
        assumptions: { dropValue: true },
      },
      async () => {
        const d = await fetchJson("https://api.xrpscan.com/api/v1/network/fees");
        const drops = d?.drops?.base_fee;
        const feeXrp = drops ? Number(drops) / 1_000_000 : null;
        return calcXrpUsd(feeXrp, priceUsd);
      }
    )
  );
  return candidates;
}

async function getFeeCandidates(chain) {
  if (chain === "btc") return getBitcoinFeeCandidates();
  if (chain === "sol") return getSolanaFeeCandidates();
  if (chain === "xrp") return getXrpFeeCandidates();
  return getEvmFeeCandidates(chain);
}

async function getBitcoinSpeedCandidates() {
  const candidates = [];

  candidates.push(
    await safeCandidate(
      {
        provider: "blockstream.info",
        type: "blocktime",
        logicId: "btc_speed_logic:block_interval_blockstream",
        sourceId: "blockstream/blocks",
        assumptions: { window: 2 },
      },
      async () => {
        const blocks = await fetchJson("https://blockstream.info/api/blocks?limit=2");
        if (!Array.isArray(blocks) || blocks.length < 2) return null;
        const t1 = blocks[0]?.timestamp;
        const t2 = blocks[1]?.timestamp;
        return Number(t1) && Number(t2) ? Math.abs(Number(t1) - Number(t2)) : null;
      }
    )
  );

  candidates.push(
    await safeCandidate(
      {
        provider: "mempool.space",
        type: "blocktime",
        logicId: "btc_speed_logic:block_interval_mempool",
        sourceId: "mempool/blocks",
        assumptions: { window: 2 },
      },
      async () => {
        const blocks = await fetchJson("https://mempool.space/api/v1/blocks");
        if (!Array.isArray(blocks) || blocks.length < 2) return null;
        const t1 = blocks[0]?.timestamp;
        const t2 = blocks[1]?.timestamp;
        return Number(t1) && Number(t2) ? Math.abs(Number(t1) - Number(t2)) : null;
      }
    )
  );

  candidates.push({
    provider: "mempool.space",
    type: "expected-recommended",
    logicId: "btc_speed_logic:estimate_recommended",
    sourceId: "heuristic",
    assumptions: { blocks: 3 },
    value: 1800,
    ok: true,
  });
  candidates.push({
    provider: "mempool.space",
    type: "expected-fastest",
    logicId: "btc_speed_logic:estimate_fastest",
    sourceId: "heuristic",
    assumptions: { blocks: 1 },
    value: 600,
    ok: true,
  });

  return candidates;
}

async function getEvmSpeedCandidates(chain) {
  const candidates = [];
  candidates.push(
    await safeCandidate(
      {
        provider: "rpc",
        type: "blocktime",
        logicId: "evm_speed_logic:block_interval",
        sourceId: "rpc/eth_getBlockByNumber",
        assumptions: { window: 2 },
      },
      async () => {
        const latestHex = await fetchRpc(chain, "eth_blockNumber", []);
        const latest = hexToNumber(latestHex);
        const b1 = await fetchRpc(chain, "eth_getBlockByNumber", ["0x" + latest.toString(16), false]);
        const b0 = await fetchRpc(chain, "eth_getBlockByNumber", ["0x" + (latest - 1).toString(16), false]);
        const t1 = hexToNumber(b1?.timestamp);
        const t0 = hexToNumber(b0?.timestamp);
        return t1 && t0 ? t1 - t0 : null;
      }
    )
  );

  const cfg = EXPLORER_V2[chain];
  if (cfg) {
    candidates.push(
      await safeCandidate(
        {
          provider: "scan-v2",
          type: "blocktime",
          logicId: "evm_speed_logic:scan_blockreward_timestamp",
          sourceId: "scan-v2/block/getblockreward",
          assumptions: { latest: true },
        },
        async () => {
          const latestHex = await fetchRpc(chain, "eth_blockNumber", []);
          const latest = hexToNumber(latestHex);
          const params = new URLSearchParams({ module: "block", action: "getblockreward", blockno: latest });
          if (cfg.apiKey) params.set("apikey", cfg.apiKey);
          const d = await fetchJson(`${cfg.baseUrl}?${params.toString()}`);
          return d?.result?.timeStamp ? Number(d.result.timeStamp) : null;
        }
      )
    );
  }

  candidates.push({
    provider: "priority-fee",
    type: "estimate-delay-fast",
    logicId: "evm_speed_logic:estimate_priority_fast",
    sourceId: "heuristic",
    assumptions: { percentile: 90 },
    value: 30,
    ok: true,
  });
  candidates.push({
    provider: "priority-fee",
    type: "estimate-delay-normal",
    logicId: "evm_speed_logic:estimate_priority_normal",
    sourceId: "heuristic",
    assumptions: { percentile: 50 },
    value: 120,
    ok: true,
  });
  return candidates;
}

async function getSolanaSpeedCandidates() {
  const endpoint = "https://api.mainnet-beta.solana.com";
  const candidates = [];
  candidates.push(
    await safeCandidate("solana-rpc", "slot-time", async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPerformanceSamples", params: [10] }),
      });
      const sample = Array.isArray(res?.result) && res.result.length > 0 ? res.result[0] : null;
      if (!sample || !sample.numSlots || !sample.samplePeriodSecs) return null;
      return sample.samplePeriodSecs / sample.numSlots;
    })
  );

  candidates.push(
    await safeCandidate("solscan", "blocktime", async () => {
      const d = await fetchJson("https://api.solscan.io/chaininfo");
      return d?.data?.blockTime;
    })
  );

  candidates.push({ provider: "rpc", type: "recent-performance", value: 0.4, ok: true });
  return candidates;
}

async function getXrpSpeedCandidates() {
  const endpoint = "https://s1.ripple.com:51234/";
  const candidates = [];
  candidates.push(
    await safeCandidate("rippled", "ledger_close_time", async () => {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "ledger", params: [{ ledger_index: "validated" }] }),
      });
      return res?.result?.ledger?.close_time_resolved ? 4 : null;
    })
  );

  candidates.push(
    await safeCandidate("xrpscan", "latest-ledger-interval", async () => {
      const d = await fetchJson("https://api.xrpscan.com/api/v1/ledger?limit=2");
      const list = d?.ledgers;
      if (!Array.isArray(list) || list.length < 2) return null;
      const t1 = new Date(list[0].close_time).getTime();
      const t0 = new Date(list[1].close_time).getTime();
      return (t1 - t0) / 1000;
    })
  );
  return candidates;
}

async function getSpeedCandidates(chain) {
  if (chain === "btc") return getBitcoinSpeedCandidates();
  if (chain === "sol") return getSolanaSpeedCandidates();
  if (chain === "xrp") return getXrpSpeedCandidates();
  return getEvmSpeedCandidates(chain);
}

function withKeys(list) {
  return (list || []).map(c => ({ ...c, key: `${c.provider}:${c.type}` }));
}

async function __TEST_calcFeeUSD(chainId, candidateKey, rawInputs = {}) {
  const priceUsd = rawInputs.priceUsd ?? (await getTestPriceUSD(chainId));
  if (Number.isFinite(rawInputs.gwei) && Number.isFinite(rawInputs.gasLimit)) {
    return calcGasUsd(rawInputs.gwei, rawInputs.gasLimit, priceUsd);
  }
  if (Number.isFinite(rawInputs.baseFee) && Number.isFinite(rawInputs.priorityFee) && Number.isFinite(rawInputs.gasLimit)) {
    return calcGasUsd(rawInputs.baseFee + rawInputs.priorityFee, rawInputs.gasLimit, priceUsd);
  }
  if (Number.isFinite(rawInputs.satPerVb) && Number.isFinite(rawInputs.vbytes)) {
    return calcBtcUsd(rawInputs.satPerVb, rawInputs.vbytes, priceUsd);
  }
  if (Number.isFinite(rawInputs.lamports)) {
    return calcSolUsd(rawInputs.lamports, rawInputs.signatures || 1, priceUsd);
  }
  if (Number.isFinite(rawInputs.xrpFee)) {
    return calcXrpUsd(rawInputs.xrpFee, priceUsd);
  }
  if (candidateKey?.includes("l2-transfer-with-l1") && Number.isFinite(rawInputs.l1Gas) && Number.isFinite(rawInputs.l2Gas)) {
    const l2 = calcGasUsd(rawInputs.l2Gas, rawInputs.gasLimit || 21_000, priceUsd);
    const l1 = calcGasUsd(rawInputs.l1Gas, rawInputs.l1DataGas || 16_000, priceUsd);
    if (Number.isFinite(l1) && Number.isFinite(l2)) return l1 + l2;
  }
  return null;
}

async function __TEST_calcSpeedSec(chainId, candidateKey, rawInputs = {}) {
  if (Array.isArray(rawInputs.timestamps) && rawInputs.timestamps.length >= 2) {
    const [t1, t0] = rawInputs.timestamps;
    const delta = Number(t1) - Number(t0);
    return Number.isFinite(delta) ? Math.abs(delta) : null;
  }
  if (Number.isFinite(rawInputs.blockInterval)) return rawInputs.blockInterval;
  if (candidateKey?.includes("expected-fastest")) return 600;
  if (candidateKey?.includes("expected-recommended")) return 1800;
  return null;
}

// ---------------- Cache resolver ----------------
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

// ---------------- Simple promise pool ----------------
async function runPromisePool(tasks, limit = 2) {
  const results = {};
  let index = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (index < tasks.length) {
      const current = tasks[index++];
      results[current.key] = await current.fn();
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------- Rate limit helper (<= ~4.5 calls/sec) ----------------
async function throttleStep(i, delayMs = 220) {
  if (i > 0) await new Promise(r => setTimeout(r, delayMs));
}

// ---------------- Handler ----------------
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

    // Independent chains in parallel (no Etherscan usage)
    const independentTasks = [
      { key: "btc", fn: () => resolveChain("btc", buildBitcoin, fallbackBitcoin, ctx) },
      { key: "sol", fn: () => resolveChain("sol", buildSolana, fallbackSolana, ctx) },
    ];
    const independentResults = await runPromisePool(independentTasks, 2);

    // EVM chains sequential + throttled to respect 5 calls/sec
    const evmChains = ["eth", "arb", "op", "base", "polygon", "bsc", "avax"];
    const evmResults = {};
    for (let i = 0; i < evmChains.length; i++) {
      const key = evmChains[i];
      await throttleStep(i);
      evmResults[key] = await resolveChain(
        key,
        c => buildEvmChain(key, c),
        c => fallbackEvmChain(key, c),
        ctx
      );
    }

    const chains = { ...independentResults, ...evmResults };

    const payload = { generatedAt, chains };
    LAST_SNAPSHOT = payload;
    LAST_AT = now;
    return res.status(200).json(payload);
  } catch (e) {
    console.error("[snapshot] fatal error:", e);

    const chainKeys = ["btc", "eth", "sol", "arb", "op", "base", "polygon", "bsc", "avax"];
    const chains = chainKeys.reduce((acc, key) => {
      const cached = LAST_GOOD_CHAINS[key];
      const fallback = cached?.data || baseChain(generatedAt);
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

// Test-only exports
if (process.env.CFS_TEST) {
  module.exports.__TEST_getFeeCandidates = async chainId => withKeys(await getFeeCandidates(chainId));
  module.exports.__TEST_getSpeedCandidates = async chainId => withKeys(await getSpeedCandidates(chainId));
  module.exports.__TEST_calcFeeUSD = __TEST_calcFeeUSD;
  module.exports.__TEST_calcSpeedSec = __TEST_calcSpeedSec;
}
