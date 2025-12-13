// scripts/generate_fee_snapshot_demo.js
// CoinGecko Demo API を使って fee_snapshot_demo.json を生成するユーティリティ
// 事前に: export COINGECKO_API_KEY="<あなたの Demo API キー>"
// Node v18+ を想定（fetch がグローバルに存在）

const API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const VS_CURRENCIES = ["usd", "jpy"];

if (!API_KEY) {
  console.error("COINGECKO_API_KEY が環境変数に入っていません。");
  process.exit(1);
}

/**
 * Phase1 で扱うチェーン一覧
 *
 * - id: Feescope 内部ID（JSONのキーになる）
 * - coingeckoId: CoinGecko simple/price 用の id
 * - nativeSymbol: ネイティブ通貨シンボル
 * - feeNative: 「標準送金」の想定手数料（暫定値。あとで調整OK）
 * - speedSec: 1トランザクション確定までのざっくり秒数
 * - status: UI 表示用のラベル（fast / normal / slow など）
 */
const CHAINS = [
  {
    id: "btc",
    label: "Bitcoin",
    coingeckoId: "bitcoin",
    nativeSymbol: "BTC",
    feeNative: 0.00003, // 暫定: 0.00003 BTC
    speedSec: 600,
    status: "normal",
  },
  {
    id: "eth",
    label: "Ethereum",
    coingeckoId: "ethereum",
    nativeSymbol: "ETH",
    // gas 15 gwei * 21000
    feeNative: 15 * 1e-9 * 21000,
    speedSec: 30,
    status: "normal",
  },
  {
    id: "bsc",
    label: "BNB Smart Chain",
    coingeckoId: "binancecoin",
    nativeSymbol: "BNB",
    feeNative: 0.000105, // 暫定（約 0.105e-3 BNB）
    speedSec: 5,
    status: "fast",
  },
  {
    id: "sol",
    label: "Solana",
    coingeckoId: "solana",
    nativeSymbol: "SOL",
    feeNative: 0.000005, // 暫定
    speedSec: 10,
    status: "fast",
  },
  {
    id: "tron",
    label: "Tron",
    coingeckoId: "tron",
    nativeSymbol: "TRX",
    feeNative: 0.1, // 暫定: 有料帯を想定
    speedSec: 5,
    status: "fast",
  },
  {
    id: "avax",
    label: "Avalanche C-Chain",
    coingeckoId: "avalanche-2",
    nativeSymbol: "AVAX",
    feeNative: 0.001, // 暫定
    speedSec: 15,
    status: "fast",
  },
  {
    id: "xrp",
    label: "XRP Ledger",
    coingeckoId: "ripple",
    nativeSymbol: "XRP",
    feeNative: 0.00001, // 暫定（現実はさらに低いことも多い）
    speedSec: 5,
    status: "fast",
  },
  {
    id: "arbitrum",
    label: "Arbitrum One",
    coingeckoId: "arbitrum", // 実トークン価格
    nativeSymbol: "ARB",
    feeNative: 0.1, // 暫定
    speedSec: 15,
    status: "fast",
  },
  {
    id: "optimism",
    label: "Optimism",
    coingeckoId: "optimism",
    nativeSymbol: "OP",
    feeNative: 0.1, // 暫定
    speedSec: 15,
    status: "fast",
  },
];

function buildSimplePriceUrl(ids) {
  const url = new URL(COINGECKO_PRICE_URL);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", VS_CURRENCIES.join(","));
  url.searchParams.set("include_24hr_change", "true");
  return url.toString();
}

// CoinGecko Demo /simple/price から価格を取得
async function fetchPrices() {
  const ids = [...new Set(CHAINS.map((c) => c.coingeckoId))];
  const url = buildSimplePriceUrl(ids);

  const res = await fetch(url, {
    headers: {
      "x-cg-demo-api-key": API_KEY,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CoinGecko エラー: ${res.status} ${body}`);
  }

  return res.json();
}

function buildChainEntry(chain, price, updated) {
  if (!price || typeof price.usd !== "number" || typeof price.jpy !== "number") {
    return null;
  }

  const feeUSD = chain.feeNative * price.usd;
  const feeJPY = chain.feeNative * price.jpy;
  const priceChange24hPct =
    typeof price.usd_24h_change === "number" ? price.usd_24h_change : null;

  return {
    label: chain.label,
    feeUSD,
    feeJPY,
    speedSec: chain.speedSec,
    status: chain.status,
    updated,
    native: {
      amount: chain.feeNative,
      symbol: chain.nativeSymbol,
    },
    tiers: [
      {
        label: "standard",
        feeUSD,
        feeJPY,
      },
    ],
    source: {
      price: {
        provider: "coingecko-demo",
        id: chain.coingeckoId,
      },
    },
    priceChange24hPct,
  };
}

// Snapshot JSON を生成
async function main() {
  const generatedAt = new Date().toISOString();
  let prices;

  try {
    prices = await fetchPrices();
  } catch (error) {
    console.error("価格取得に失敗しました:", error.message);
    process.exit(1);
  }

  const chains = {};

  for (const chain of CHAINS) {
    const entry = buildChainEntry(chain, prices[chain.coingeckoId], generatedAt);

    if (!entry) {
      console.warn(
        `価格が取得できなかったためスキップ: ${chain.id} (coingeckoId=${chain.coingeckoId})`
      );
      continue;
    }

    chains[chain.id] = entry;
  }

  const snapshot = {
    generatedAt,
    vsCurrencies: VS_CURRENCIES,
    chains,
  };

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((e) => {
  console.error("実行エラー:", e);
  process.exit(1);
});
