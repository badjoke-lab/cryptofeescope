// api/snapshot.js
// app.js が期待している形に合わせた版
// snapshot = { bitcoin: {...}, ethereum: {...}, arbitrum: {...}, optimism: {...}, solana: {...} }

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// ---------- 共通ユーティリティ ----------

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
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function decideStatus(feeUsd, speedSec) {
  const fee = Number(feeUsd) || 0;
  const s = Number(speedSec) || 0;
  if (fee < 0.05 && s < 5 * 60) return "fast";
  if (fee > 1 || s > 60 * 60) return "slow";
  return "avg";
}

async function safeBuild(builder) {
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
    const data = await fetchJson(`${baseUrl}?${params.toString()}`, { headers });
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

// ---------- 各チェーン ----------

// Bitcoin: mempool.space recommended fees
async function buildBitcoin(prices) {
  const btcPrice = prices.BTC;
  if (!btcPrice) throw new Error("No BTC price");

  const data = await fetchJson("https://mempool.space/api/v1/fees/recommended");
  const TX_VBYTES = 140; // ざっくり 1 in 2 out

  const tiersSrc = [
    {
      key: "fast",
      label: "Fast (~10 min)",
      feeRate: data.fastestFee,
      speed: 10 * 60,
    },
    {
      key: "standard",
      label: "Normal (~30 min)",
      feeRate: data.halfHourFee,
      speed: 30 * 60,
    },
    {
      key: "slow",
      label: "Slow (~60 min)",
      feeRate: data.hourFee,
      speed: 60 * 60,
    },
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
      // app.js は speedMinSec / speedMaxSec を見ているので両方入れておく
      speedMinSec: t.speed,
      speedMaxSec: t.speed,
    };
  });

  const main =
    tiers.find(t => t.tier === "standard") || tiers[0] || null;

  const now = new Date().toISOString();
  const feeMain = main ? main.feeUSD : null;
  const speedMain = main ? main.speedMinSec : null;

  return {
    feeUSD: feeMain,
    speedSec: speedMain,
    status: decideStatus(feeMain, speedMain),
    updated: now,
    tiers,
    priceUSD: btcPrice,
  };
}

// Ethereum: Etherscan Gas Oracle v2
async function buildEthereum(prices) {
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

  function mkTier(key, gwei, label, speedSec) {
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
    mkTier("fast", r.FastGasPrice, "Fast (~30 sec)", 30),
    mkTier("standard", r.ProposeGasPrice, "Normal (~2 min)", 120),
    mkTier("slow", r.SafeGasPrice, "Slow (~5 min)", 300),
  ];

  const main =
    tiers.find(t => t.tier === "standard") || tiers[0] || null;

  const now = new Date().toISOString();
  const feeMain = main ? main.feeUSD : null;
  const speedMain = main ? main.speedMinSec : null;

  return {
    feeUSD: feeMain,
    speedSec: speedMain,
    status: decideStatus(feeMain, speedMain),
    updated: now,
    tiers,
    priceUSD: ethPrice,
  };
}

// Solana: base fee（priority fee はまだ入れない）
async function buildSolana(prices) {
  const solPrice = prices.SOL;
  if (!solPrice) throw new Error("No SOL price");

  const LAMPORTS_PER_SIGNATURE = 5000;
  const signatures = 1;
  const lamports = LAMPORTS_PER_SIGNATURE * signatures;
  const feeSol = lamports / 1e9;
  const feeUsd = feeSol * solPrice;
  const speed = 10; // 秒

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
    feeUSD: feeUsd,
    speedSec: speed,
    status: decideStatus(feeUsd, speed),
    updated: now,
    tiers: [tier],
    priceUSD: solPrice,
  };
}

// Arbitrum / Optimism: まだ安全な計算ロジックを入れていないので「値なし」を正直に返す
async function buildL2Placeholder(prices, which) {
  const price =
    which === "arbitrum" ? prices.ARB : which === "optimism" ? prices.OP : null;
  const now = new Date().toISOString();

  return {
    feeUSD: null,
    speedSec: null,
    status: "avg",
    updated: now,
    tiers: [],
    priceUSD: price,
    note:
      "L2 fee estimation not yet implemented; placeholder only (no fake values).",
  };
}

// ---------- ハンドラ ----------

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const prices = await getUsdPrices();

  const snapshot = {};

  snapshot.bitcoin = await safeBuild(() => buildBitcoin(prices));
  snapshot.ethereum = await safeBuild(() => buildEthereum(prices));
  snapshot.arbitrum = await safeBuild(() =>
    buildL2Placeholder(prices, "arbitrum")
  );
  snapshot.optimism = await safeBuild(() =>
    buildL2Placeholder(prices, "optimism")
  );
  snapshot.solana = await safeBuild(() => buildSolana(prices));

  return res.status(200).json(snapshot);
}
