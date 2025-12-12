// scripts/generate_fee_snapshot_demo.js
// 事前に: export COINGECKO_API_KEY="あなたのDemoキー"
// Node v18+ 想定（fetch グローバル）

const API_KEY = process.env.COINGECKO_API_KEY;
if (!API_KEY) {
  console.error("COINGECKO_API_KEY が環境変数に入っていない");
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
    feeNative: 0.000105, // 暫定
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

// CoinGecko Demo /simple/price から価格を取得
async function fetchPrices() {
  const ids = [...new Set(CHAINS.map((c) => c.coingeckoId))];

  const url =
    "https://api.coingecko.com/api/v3/simple/price?" +
    new URLSearchParams({
      ids: ids.join(","),
      vs_currencies: "usd,jpy",
    }).toString();

  const res = await fetch(url, {
    headers: {
      "x-cg-demo-api-key": API_KEY,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error("CoinGecko エラー:", res.status, await res.text());
    process.exit(1);
  }

  return res.json();
}

// Snapshot JSON を生成
async function main() {
  const generatedAt = new Date().toISOString();
  const prices = await fetchPrices();

  const chains = {};

  for (const chain of CHAINS) {
    const priceObj = prices[chain.coingeckoId];
    if (!priceObj || typeof priceObj.usd !== "number" || typeof priceObj.jpy !== "number") {
      console.warn(
        `価格が取得できなかったためスキップ: ${chain.id} (coingeckoId=${chain.coingeckoId})`
      );
      continue;
    }

    const usd = priceObj.usd;
    const jpy = priceObj.jpy;

    const feeUSD = chain.feeNative * usd;
    const feeJPY = chain.feeNative * jpy;

    const updated = generatedAt;

    chains[chain.id] = {
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
    };
  }

  const snapshot = {
    generatedAt,
    vsCurrencies: ["usd", "jpy"],
    chains,
  };

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((e) => {
  console.error("実行エラー:", e);
  process.exit(1);
});
