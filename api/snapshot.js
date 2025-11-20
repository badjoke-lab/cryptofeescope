// api/snapshot.js

// ===== 設定周り =====

// CoinGecko: 無料枠なら public API、APIキーがあれば pro-api を使う
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;

// Etherscan: ETH の Gas Oracle 用
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// USD → JPY や他通貨への換算はフロント側でする前提なので、ここでは USD のみ返す

// 共通ユーティリティ
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    // Vercel の Node ランタイムなら fetch 利用可
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

// エラーがあってもチェーンごとに潰すヘルパ
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

// ステータス判定（かなりラフ。ここはあとで調整可）
function deriveStatus(feeUsd, speedSec) {
  if (feeUsd == null || speedSec == null) return "unknown";
  if (feeUsd < 0.01 && speedSec < 60) return "fast-cheap";
  if (feeUsd < 0.5 && speedSec < 600) return "normal";
  if (feeUsd < 5 && speedSec < 3600) return "slow";
  return "expensive";
}

// ===== 価格取得（USD） =====

async function getUsdPrices() {
  // BTC / ETH / SOL / ARB / OP の価格
  const ids = [
    "bitcoin",
    "ethereum",
    "solana",
    "arbitrum",
    "optimism",
  ];

  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
  });

  const usePro = !!COINGECKO_API_KEY;
  const baseUrl = usePro
    ? "https://pro-api.coingecko.com/api/v3/simple/price"
    : "https://api.coingecko.com/api/v3/simple/price";

  const headers = usePro
    ? { "x-cg-pro-api-key": COINGECKO_API_KEY }
    : {};

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
    // 価格が取れなければ feeUsd は null にする
    return {
      BTC: null,
      ETH: null,
      SOL: null,
      ARB: null,
      OP: null,
    };
  }
}

// ===== 各チェーンのビルダー =====

// 1) Bitcoin: mempool.space Recommended Fees (sat/vB)
//    https://mempool.space/api/v1/fees/recommended
async function buildBitcoin({ prices }) {
  const btcPrice = prices.BTC;
  if (!btcPrice) throw new Error("No BTC price");

  const data = await fetchJson(
    "https://mempool.space/api/v1/fees/recommended"
  );
  // data: { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }

  const TX_VBYTES = 140; // 1-in-2-out のシンプルトランザクションをざっくり想定

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

  const main = tiers[1] || tiers[0]; // Normal

  const now = new Date().toISOString();
  return {
    feeUsd: main ? main.feeUsd : null,
    speedSec: main ? main.speedSec : null,
    status: main ? deriveStatus(main.feeUsd, main.speedSec) : "unknown",
    updatedAt: now,
    tiers,
    meta: {
      priceUsd: btcPrice,
      source: "mempool.space",
    },
  };
}

// 2) Ethereum (L1): Etherscan Gas Oracle (V2 API)
//    https://api.etherscan.io/v2/api?module=gastracker&action=gasoracle&chainid=1&apikey=...
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

  if (!data.result) {
    throw new Error("No gasoracle.result from Etherscan");
  }

  // result: { SafeGasPrice, ProposeGasPrice, FastGasPrice, ... } (単位: gwei)
  const r = data.result;

  const GAS_LIMIT = 21000; // 単純な ETH 送金一回分を想定

  function tierFrom(gwei, label, speedSec) {
    const gasPriceEth = (Number(gwei) || 0) * 1e-9;
    const feeEth = gasPriceEth * GAS_LIMIT;
    const feeUsd = feeEth * ethPrice;
    return {
      tier: label.toLowerCase(),
      label,
      gasPrice: Number(gwei) || 0,
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
      gasOracleSource: "Etherscan Gas Oracle v2",
    },
  };
}

// 3) Solana: ベースフィーは 1 トランザクション 5,000 lamports / signature 前後を想定
//    ここでは「1署名・優先料金なし」の最低ラインだけ出す。
//    実際の priority fee まではまだ追わない（ウソの値を出さないため）
async function buildSolana({ prices }) {
  const solPrice = prices.SOL;
  if (!solPrice) throw new Error("No SOL price");

  const LAMPORTS_PER_SIGNATURE = 5000; // 現状の代表値（将来変わる可能性あり）

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
      speedSec: 10, // Solana のブロックタイムは 0.4〜1秒程度だが、余裕を持ってざっくり
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
      note: "Priority fee not included (base fee only)",
    },
  };
}

// 4) Arbitrum / Optimism: まだ安全なロジックを詰めきれていないので
//    現段階では「値を出さずにダッシュ（—）表示」にする。
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
      note:
        "L2 fee estimation not yet implemented; showing placeholder only (no fake values).",
    },
  };
}

// ===== メインハンドラ =====

export default async function handler(req, res) {
  // CORS を緩めに許可（フロントが同一オリジンなら必須ではないが念のため）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const generatedAt = new Date().toISOString();

  const prices = await getUsdPrices();

  const baseInfos = [
    {
      id: "btc",
      name: "Bitcoin",
      ticker: "BTC",
      layer: "L1",
      family: "bitcoin",
    },
    {
      id: "eth",
      name: "Ethereum",
      ticker: "ETH",
      layer: "L1",
      family: "evm",
    },
    {
      id: "arb",
      name: "Arbitrum One",
      ticker: "ARB",
      layer: "L2",
      family: "evm",
    },
    {
      id: "op",
      name: "Optimism",
      ticker: "OP",
      layer: "L2",
      family: "evm",
    },
    {
      id: "sol",
      name: "Solana",
      ticker: "SOL",
      layer: "L1",
      family: "solana",
    },
  ];

  const ctx = { prices };

  const [btc, eth, arb, op, sol] = await Promise.all([
    safeBuildChain(buildBitcoin, baseInfos[0], ctx),
    safeBuildChain(buildEthereum, baseInfos[1], ctx),
    safeBuildChain(
      (c) => buildL2Placeholder(c, "arb"),
      baseInfos[2],
      ctx
    ),
    safeBuildChain(
      (c) => buildL2Placeholder(c, "op"),
      baseInfos[3],
      ctx
    ),
    safeBuildChain(buildSolana, baseInfos[4], ctx),
  ]);

  const payload = {
    ok: true,
    generatedAt,
    pricesUsd: prices, // { BTC, ETH, SOL, ARB, OP }
    chains: [btc, eth, arb, op, sol],
  };

  return res.status(200).json(payload);
}
