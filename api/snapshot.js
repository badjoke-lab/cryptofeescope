// api/snapshot.js

// ===== 共通ユーティリティ =====

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

// ===== 価格取得（Coinbase, 認証不要） =====
//
// https://api.coinbase.com/v2/exchange-rates?currency=USD
// → { data: { currency: "USD", rates: { BTC: "0.000015", ETH: "...", ... } } }
// これは「1 USD = x BTC」というレートなので priceUsd = 1 / x で求める。

async function getUsdPrices() {
  try {
    const data = await fetchJson(
      "https://api.coinbase.com/v2/exchange-rates?currency=USD"
    );
    const rates = data?.data?.rates || {};

    function priceFromRate(symbol) {
      const r = Number(rates[symbol]);
      if (!r || !isFinite(r) || r <= 0) return null;
      // 1 USD = r BTC → 1 BTC = 1 / r USD
      return 1 / r;
    }

    return {
      BTC: priceFromRate("BTC"),
      ETH: priceFromRate("ETH"),
      SOL: priceFromRate("SOL"),
      ARB: priceFromRate("ARB") ?? null, // Coinbase に無ければ null
      OP: priceFromRate("OP") ?? null,
    };
  } catch (e) {
    console.error("[snapshot] price fetch failed (Coinbase):", e.message);
    return {
      BTC: null,
      ETH: null,
      SOL: null,
      ARB: null,
      OP: null,
    };
  }
}

// ===== 各チェーン =====

// BTC: mempool.space の Recommended Fees
// https://mempool.space/api/v1/fees/recommended
async function buildBitcoin({ prices }) {
  const btcPrice = prices.BTC;
  if (!btcPrice) throw new Error("No BTC price from Coinbase");

  const data = await fetchJson(
    "https://mempool.space/api/v1/fees/recommended"
  );

  const TX_VBYTES = 140; // ざっくり 1-in-2-out の送金

  const tiers = [
    {
      tier: "fast",
      label: "Fast (~10 min)",
      feeRate: data.fastestFee,
      speedSec: 10 * 60,
    },
    {
      tier: "normal",
      label: "Normal (~30 min)",
      feeRate: data.halfHourFee,
      speedSec: 30 * 60,
    },
    {
      tier: "slow",
      label: "Slow (~60 min)",
      feeRate: data.hourFee,
      speedSec: 60 * 60,
    },
  ].map((t) => {
    const feeBtc = (t.feeRate * TX_VBYTES) / 1e8;
    const feeUsd = feeBtc * btcPrice;
    return {
      ...t,
      gasUnit: "sat/vB",
      feeBtc,
      feeUsd,
    };
  });

  const main = tiers[1] || tiers[0];
  const now = new Date().toISOString();

  return {
    feeUsd: main ? main.feeUsd : null,
    speedSec: main ? main.speedSec : null,
    status: main ? deriveStatus(main.feeUsd, main.speedSec) : "unknown",
    updatedAt: now,
    tiers,
    meta: {
      priceUsd: btcPrice,
      priceSource: "Coinbase /v2/exchange-rates",
      feeSource: "mempool.space recommended fees",
    },
  };
}

// ETH (L1): Etherscan Gas Oracle v2
async function buildEthereum({ prices }) {
  const ethPrice = prices.ETH;
  if (!ethPrice) throw new Error("No ETH price from Coinbase");

  const apiKey = process.env.ETHERSCAN_API_KEY || "";
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY not set");

  const params = new URLSearchParams({
    module: "gastracker",
    action: "gasoracle",
    chainid: "1",
    apikey: apiKey,
  });

  const data = await fetchJson(
    `https://api.etherscan.io/v2/api?${params.toString()}`
  );

  const r = data.result;
  if (!r) throw new Error("No gasoracle.result from Etherscan");

  const GAS_LIMIT = 21000;

  function tierFrom(gwei, label, speedSec) {
    const g = Number(gwei) || 0;
    const gasPriceEth = g * 1e-9;
    const feeEth = gasPriceEth * GAS_LIMIT;
    const feeUsd = feeEth * ethPrice;
    return {
      tier: label.toLowerCase(),
      label,
      gasPrice: g,
      gasUnit: "gwei",
      gasLimit: GAS_LIMIT,
      feeEth,
      feeUsd,
      speedSec,
    };
  }

  const tiers = [
    tierFrom(r.FastGasPrice, "Fast (~30 sec)", 30),
    tierFrom(r.ProposeGasPrice, "Normal (~2 min)", 120),
    tierFrom(r.SafeGasPrice, "Slow (~5 min)", 300),
  ];

  const main = tiers[1] || tiers[0];
  const now = new Date().toISOString();

  return {
    feeUsd: main ? main.feeUsd : null,
    speedSec: main ? main.speedSec : null,
    status: main ? deriveStatus(main.feeUsd, main.speedSec) : "unknown",
    updatedAt: now,
    tiers,
    meta: {
      priceUsd: ethPrice,
      priceSource: "Coinbase /v2/exchange-rates",
      gasOracleSource: "Etherscan Gas Oracle v2",
    },
  };
}

// SOL: ベースフィーのみ（優先料金はまだ入れない）
async function buildSolana({ prices }) {
  const solPrice = prices.SOL;
  if (!solPrice) throw new Error("No SOL price from Coinbase");

  const LAMPORTS_PER_SIGNATURE = 5000;

  const signatures = 1;
  const lamports = LAMPORTS_PER_SIGNATURE * signatures;
  const feeSol = lamports / 1e9;
  const feeUsd = feeSol * solPrice;

  const now = new Date().toISOString();

  const tiers = [
    {
      tier: "base",
      label: "Base fee (no priority)",
      lamports,
      lamportsPerSignature: LAMPORTS_PER_SIGNATURE,
      signatures,
      feeSol,
      feeUsd,
      speedSec: 10,
    },
  ];

  const main = tiers[0];

  return {
    feeUsd: main.feeUsd,
    speedSec: main.speedSec,
    status: deriveStatus(main.feeUsd, main.speedSec),
    updatedAt: now,
    tiers,
    meta: {
      priceUsd: solPrice,
      priceSource: "Coinbase /v2/exchange-rates",
      note: "Priority fee not included (base fee only)",
    },
  };
}

// L2（Arbitrum / Optimism）：まだ安全なロジックを詰めていないので placeholder
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
    meta: {
      priceUsd: price,
      priceSource: "Coinbase /v2/exchange-rates",
      note:
        "L2 fee estimation not yet implemented; showing placeholder only (no fake values).",
    },
  };
}

// ===== メインハンドラ =====

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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
