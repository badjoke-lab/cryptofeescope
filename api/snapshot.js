// api/snapshot.js
// 互換モード版: 既存フロントが拾いそうな形をできるだけ全部入れる

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// -------- 共通ユーティリティ --------

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function safeBuildChain(builder, baseInfo, ctx) {
  try {
    const chain = await builder(ctx);
    return {
      ...baseInfo,
      ...chain,
      error: null,
    };
  } catch (e) {
    console.error(`[snapshot] ${baseInfo.id} failed:`, e.message);
    const now = new Date().toISOString();
    return {
      ...baseInfo,
      feeUsd: null,
      speedSec: null,
      status: "error",
      updatedAt: now,
      tiers: [],
      fees: {},
      speeds: {},
      current: { usd: null, speedSec: null },
      meta: {
        error: e.message.slice(0, 200),
      },
    };
  }
}

function deriveStatus(feeUsd, speedSec) {
  if (feeUsd == null || speedSec == null) return "unknown";
  if (feeUsd < 0.01 && speedSec < 60) return "fast-cheap";
  if (feeUsd < 0.5 && speedSec < 600) return "normal";
  if (feeUsd < 5 && speedSec < 3600) return "slow";
  return "expensive";
}

// -------- 価格取得（USD） --------

async function getUsdPrices() {
  const ids = ["bitcoin", "ethereum", "solana", "arbitrum", "optimism"];

  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
  });

  const usePro = !!COINGECKO_API_KEY;
  const baseUrl = usePro
    ? "https://pro-api.coingecko.com/api/v3/simple/price"
    : "https://api.coingecko.com/api/v3/simple/price";

  const headers = usePro ? { "x-cg-pro-api-key": COINGECKO_API_KEY } : {};

  try {
    const data = await fetchJson(`${baseUrl}?${params.toString()}`, {
      headers,
    });

    return {
      BTC: data.bitcoin?.usd ?? null,
      ETH: data.ethereum?.usd ?? null,
      SOL: data.solana?.usd ?? null,
      ARB: data.arbitrum?.usd ?? null,
      OP: data.optimism?.usd ?? null,
    };
  } catch (e) {
    console.error("[snapshot] price fetch failed:", e.message);
    return {
      BTC: null,
      ETH: null,
      SOL: null,
      ARB: null,
      OP: null,
    };
  }
}

// -------- 各チェーン --------

// BTC: mempool.space recommended fees
async function buildBitcoin({ prices }) {
  const btcPrice = prices.BTC;
  if (!btcPrice) throw new Error("No BTC price");

  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
  const TX_VBYTES = 140; // 1-in-2-out tx を想定

  const rawTiers = [
    {
      key: "fast",
      label: "Fast (~10 min)",
      feeRate: data.fastestFee,
      speedSec: 10 * 60,
    },
    {
      key: "standard", // normal の別名
      label: "Normal (~30 min)",
      feeRate: data.halfHourFee,
      speedSec: 30 * 60,
    },
    {
      key: "slow",
      label: "Slow (~60 min)",
      feeRate: data.hourFee,
      speedSec: 60 * 60,
    },
  ];

  const tiersArray = rawTiers.map((t) => {
    const feeBtc = (t.feeRate * TX_VBYTES) / 1e8;
    const feeUsd = feeBtc * btcPrice;
    return {
      tier: t.key,
      label: t.label,
      feeRate: t.feeRate,
      gasUnit: "sat/vB",
      txVbytes: TX_VBYTES,
      feeBtc,
      feeUsd,
      speedSec: t.speedSec,
    };
  });

  // 互換のための object 形式
  const feesUsd = {};
  const speeds = {};
  for (const t of tiersArray) {
    feesUsd[t.tier] = t.feeUsd;
    speeds[t.tier] = t.speedSec;
    if (t.tier === "standard") {
      // 「normal」を見るコード対策
      feesUsd.normal = t.feeUsd;
      speeds.normal = t.speedSec;
    }
  }

  const main =
    tiersArray.find((t) => t.tier === "standard") || tiersArray[0] || null;

  const now = new Date().toISOString();
  const feeMain = main ? main.feeUsd : null;
  const speedMain = main ? main.speedSec : null;

  return {
    feeUsd: feeMain,
    speedSec: speedMain,
    status: main ? deriveStatus(feeMain, speedMain) : "unknown",
    updatedAt: now,
    tiers: tiersArray,
    fees: {
      usd: feesUsd,
    },
    speeds,
    current: {
      usd: feeMain,
      speedSec: speedMain,
    },
    meta: {
      priceUsd: btcPrice,
      source: "mempool.space",
    },
  };
}

// ETH: Etherscan Gas Oracle v2
async function buildEthereum({ prices }) {
  const ethPrice = prices.ETH;
  if (!ethPrice) throw new Error("No ETH price");
  if (!ETHERSCAN_API_KEY) throw new Error("ETHERSCAN_API_KEY not set");

  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    chainid: "1",
    apikey: ETHERSCAN_API_KEY,
  });

  const data = await fetchJson(
    `https://api.etherscan.io/v2/api?${params.toString()}`
  );
  if (!data.result) throw new Error("No gasoracle.result from Etherscan");

  const r = data.result;
  const GAS_LIMIT = 21000;

  function makeTier(key, gwei, label, speedSec) {
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
      feeEth,
      feeUsd,
      speedSec,
    };
  }

  const tiersArray = [
    makeTier("fast", r.FastGasPrice, "Fast (~30 sec)", 30),
    makeTier("standard", r.ProposeGasPrice, "Normal (~2 min)", 120),
    makeTier("slow", r.SafeGasPrice, "Slow (~5 min)", 300),
  ];

  const feesUsd = {};
  const speeds = {};
  for (const t of tiersArray) {
    feesUsd[t.tier] = t.feeUsd;
    speeds[t.tier] = t.speedSec;
    if (t.tier === "standard") {
      feesUsd.normal = t.feeUsd;
      speeds.normal = t.speedSec;
    }
  }

  const main =
    tiersArray.find((t) => t.tier === "standard") || tiersArray[0] || null;

  const now = new Date().toISOString();
  const feeMain = main ? main.feeUsd : null;
  const speedMain = main ? main.speedSec : null;

  return {
    feeUsd: feeMain,
    speedSec: speedMain,
    status: main ? deriveStatus(feeMain, speedMain) : "unknown",
    updatedAt: now,
    tiers: tiersArray,
    fees: {
      usd: feesUsd,
    },
    speeds,
    current: {
      usd: feeMain,
      speedSec: speedMain,
    },
    meta: {
      priceUsd: ethPrice,
      gasOracleSource: "Etherscan Gas Oracle v2",
    },
  };
}

// SOL: base fee のみ（priority fee はまだ入れない）
async function buildSolana({ prices }) {
  const solPrice = prices.SOL;
  if (!solPrice) throw new Error("No SOL price");

  const LAMPORTS_PER_SIGNATURE = 5000;
  const signatures = 1;
  const lamports = LAMPORTS_PER_SIGNATURE * signatures;
  const feeSol = lamports / 1e9;
  const feeUsd = feeSol * solPrice;
  const speedSec = 10;

  const tiersArray = [
    {
      tier: "base",
      label: "Base fee (no priority)",
      lamports,
      lamportsPerSignature: LAMPORTS_PER_SIGNATURE,
      signatures,
      feeSol,
      feeUsd,
      speedSec,
    },
  ];

  const now = new Date().toISOString();

  return {
    feeUsd,
    speedSec,
    status: deriveStatus(feeUsd, speedSec),
    updatedAt: now,
    tiers: tiersArray,
    fees: {
      usd: {
        base: feeUsd,
      },
    },
    speeds: {
      base: speedSec,
    },
    current: {
      usd: feeUsd,
      speedSec,
    },
    meta: {
      priceUsd: solPrice,
      note: "Priority fee not included (base fee only)",
    },
  };
}

// L2: まだロジックが決まってないので値は出さない
async function buildL2Placeholder({ prices }, which) {
  const price =
    which === "arb" ? prices.ARB : which === "op" ? prices.OP : null;
  const now = new Date().toISOString();

  return {
    feeUsd: null,
    speedSec: null,
    status: "unknown",
    updatedAt: now,
    tiers: [],
    fees: { usd: {} },
    speeds: {},
    current: { usd: null, speedSec: null },
    meta: {
      priceUsd: price,
      note:
        "L2 fee estimation not yet implemented; showing placeholder only (no fake values).",
    },
  };
}

// -------- メインハンドラ --------

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const generatedAt = new Date().toISOString();
  const prices = await getUsdPrices();

  const baseInfos = [
    { id: "btc", name: "Bitcoin", ticker: "BTC", layer: "L1", family: "bitcoin" },
    { id: "eth", name: "Ethereum", ticker: "ETH", layer: "L1", family: "evm" },
    { id: "arb", name: "Arbitrum One", ticker: "ARB", layer: "L2", family: "evm" },
    { id: "op", name: "Optimism", ticker: "OP", layer: "L2", family: "evm" },
    { id: "sol", name: "Solana", ticker: "SOL", layer: "L1", family: "solana" },
  ];

  const ctx = { prices };

  const [btc, eth, arb, op, sol] = await Promise.all([
    safeBuildChain(buildBitcoin, baseInfos[0], ctx),
    safeBuildChain(buildEthereum, baseInfos[1], ctx),
    safeBuildChain((c) => buildL2Placeholder(c, "arb"), baseInfos[2], ctx),
    safeBuildChain((c) => buildL2Placeholder(c, "op"), baseInfos[3], ctx),
    safeBuildChain(buildSolana, baseInfos[4], ctx),
  ]);

  const payload = {
    ok: true,
    generatedAt,
    pricesUsd: prices,
    chains: [btc, eth, arb, op, sol],
  };

  return res.status(200).json(payload);
}
