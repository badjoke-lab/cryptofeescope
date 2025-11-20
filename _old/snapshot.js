// api/snapshot.js
//
// CryptoFeeScope v1 正式版用: 公式APIベースで毎回計算するリアルタイム snapshot
// - フロントの app.js / UI 仕様は一切変更しない
// - /api/push-history もこの snapshot を読むので歴史データも同じロジックになる

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price' +
  '?ids=bitcoin,ethereum,arbitrum,optimism,solana&vs_currencies=usd';

// だめだったときのセカンダリ（価格用）
const CRYPTOCOMPARE_URL =
  'https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH,ARB,OP,SOL&tsyms=USD';

// BTC fee: mempool.space → fallback: Blockchair
const MEMPOOL_FEE_URL = 'https://mempool.space/api/v1/fees/recommended';
const BLOCKCHAIR_BTC_STATS =
  'https://api.blockchair.com/bitcoin/stats';

// ETH / ARB / OP: Etherscan 系ガスオラクル
const ETHERSCAN_GAS_URL = (apiKey) =>
  `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey || ''}`;

const ARBISCAN_GAS_URL = (apiKey) =>
  `https://api.arbiscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey || ''}`;

const OPTIMISTICSCAN_GAS_URL = (apiKey) =>
  `https://api-optimistic.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${apiKey || ''}`;

// Solana RPC（公式ドキュメントの JSON-RPC）
// 環境変数 SOLANA_RPC_URL があればそれを優先。
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// ===== 共通ユーティリティ =====

async function safeJsonFetch(url, options = {}, label = '') {
  const res = await fetch(url, {
    // Vercel/Node18 の fetch を前提
    ...options,
    headers: {
      'User-Agent': 'CryptoFeeScope/1.0',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed fetch ${label || url}: ${res.status} ${res.statusText}`
    );
  }
  return res.json();
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ===== 価格（USD）取得 =====

async function fetchPricesUSD() {
  // 1. Coingecko（公式寄りの無料API）
  try {
    const data = await safeJsonFetch(COINGECKO_URL, {}, 'coingecko');
    const out = {
      BTC: safeNumber(data.bitcoin?.usd),
      ETH: safeNumber(data.ethereum?.usd),
      ARB: safeNumber(data.arbitrum?.usd),
      OP: safeNumber(data.optimism?.usd),
      SOL: safeNumber(data.solana?.usd),
    };
    if (!out.BTC || !out.ETH || !out.SOL) {
      throw new Error('coingecko missing some prices');
    }
    return out;
  } catch (err) {
    console.error('[price] Coingecko failed, fallback to CryptoCompare:', err);
  }

  // 2. CryptoCompare fallback
  const data = await safeJsonFetch(CRYPTOCOMPARE_URL, {}, 'cryptocompare');
  return {
    BTC: safeNumber(data.BTC?.USD),
    ETH: safeNumber(data.ETH?.USD),
    ARB: safeNumber(data.ARB?.USD),
    OP: safeNumber(data.OP?.USD),
    SOL: safeNumber(data.SOL?.USD),
  };
}

// ===== BTC fee =====
//
// mempool.space の recommended fee（sat/vB）から
//   - 150 vB の P2WPKH 転送を想定
//   - halfHourFee を「標準」ティアに使う

async function fetchBitcoinSnapshot(prices) {
  const priceUsd = prices.BTC || 0;
  if (!priceUsd) {
    throw new Error('BTC price missing');
  }

  let primary;
  try {
    primary = await safeJsonFetch(MEMPOOL_FEE_URL, {}, 'mempool.space');
  } catch (err) {
    console.error('[btc] mempool.space failed, fallback to Blockchair:', err);
  }

  let fastestSatVb;
  let normalSatVb;
  let slowSatVb;

  if (primary && primary.fastestFee) {
    fastestSatVb = safeNumber(primary.fastestFee);
    normalSatVb = safeNumber(primary.halfHourFee || primary.hourFee);
    slowSatVb =
      safeNumber(primary.hourFee) || safeNumber(primary.economyFee || 1);
  } else {
    // fallback: Blockchair stats
    const stats = await safeJsonFetch(BLOCKCHAIR_BTC_STATS, {}, 'blockchair');
    const satPerByte =
      stats?.data?.suggested_transaction_fee_per_byte_sat ?? 5;
    fastestSatVb = satPerByte * 1.5;
    normalSatVb = satPerByte;
    slowSatVb = satPerByte * 0.7;
  }

  // 150 vbytes を標準トランザクションサイズとして仮定
  const VBYTES = 150;

  function feeUsdFromSatPerVb(satPerVb) {
    const sats = satPerVb * VBYTES;
    const btc = sats / 1e8;
    return btc * priceUsd;
  }

  const feeFastUsd = feeUsdFromSatPerVb(fastestSatVb);
  const feeNormUsd = feeUsdFromSatPerVb(normalSatVb);
  const feeSlowUsd = feeUsdFromSatPerVb(slowSatVb);

  // speedSec は「おおよその期待値」
  const tiers = [
    {
      tier: 'Fast',
      gasPrice: Math.round(fastestSatVb),
      gasUnit: 'sat/vB',
      feeUSD: feeFastUsd,
      speedMinSec: 60, // ~1 block
      speedMaxSec: 600,
    },
    {
      tier: 'Normal',
      gasPrice: Math.round(normalSatVb),
      gasUnit: 'sat/vB',
      feeUSD: feeNormUsd,
      speedMinSec: 600, // ~1–3 blocks
      speedMaxSec: 1800,
    },
    {
      tier: 'Slow',
      gasPrice: Math.round(slowSatVb),
      gasUnit: 'sat/vB',
      feeUSD: feeSlowUsd,
      speedMinSec: 1800, // 30分〜
      speedMaxSec: 7200,
    },
  ];

  // テーブルの「Fee」「Speed」は Normal ティアベース
  const feeUSD = feeNormUsd;
  const speedSec = (tiers[1].speedMinSec + tiers[1].speedMaxSec) / 2;

  return {
    feeUSD,
    speedSec,
    status: classifyStatus(feeUSD, speedSec),
    updated: new Date().toISOString(),
    tieredSpeed: true,
    tiers,
  };
}

// ===== EVM 系 (ETH / ARB / OP) =====
//
// Etherscan 系 Gas Oracle から Safe / Propose / Fast の gwei を取って
//   - トランザクションの gas を 21,000 とする（標準送金）
//   - USD 価格を掛けて 1 tx のコストを計算
//
// 公式 API がこけたとき用に「想定固定値」を fallback に持つ。

async function fetchEvmGasOracle(kind, apiKey, priceUsd, fallbackGwei = 1) {
  let urlFunc;
  switch (kind) {
    case 'eth': {
      urlFunc = ETHERSCAN_GAS_URL;
      break;
    }
    case 'arb': {
      urlFunc = ARBISCAN_GAS_URL;
      break;
    }
    case 'op': {
      urlFunc = OPTIMISTICSCAN_GAS_URL;
      break;
    }
    default:
      throw new Error('unknown EVM kind');
  }

  try {
    const json = await safeJsonFetch(urlFunc(apiKey), {}, `${kind}-gasoracle`);
    if (json.status !== '1' || !json.result) {
      throw new Error('gas oracle returned non-1 status');
    }
    const r = json.result;
    const safe = safeNumber(r.SafeGasPrice);
    const prop = safeNumber(r.ProposeGasPrice);
    const fast = safeNumber(r.FastGasPrice);
    return {
      safe: safe || fallbackGwei,
      propose: prop || fallbackGwei,
      fast: fast || fallbackGwei * 1.5,
    };
  } catch (err) {
    console.error(`[${kind}] gas oracle failed, fallback gwei`, err);
    const base = fallbackGwei || 0.1;
    return {
      safe: base,
      propose: base * 1.3,
      fast: base * 2,
    };
  }
}

function feeUsdFromGwei(gwei, gasUsed, priceUsd) {
  const gweiPerEth = 1e9;
  const eth = (gwei * gasUsed) / gweiPerEth;
  return eth * priceUsd;
}

function classifyStatus(feeUsd, speedSec) {
  const f = feeUsd || 0;
  const s = speedSec || 0;
  if (f < 0.05 && s < 10) return 'fast';
  if (f > 0.5 || s > 60) return 'slow';
  return 'avg';
}

async function fetchEthereumSnapshot(prices) {
  const priceUsd = prices.ETH || 0;
  if (!priceUsd) throw new Error('ETH price missing');

  const gas = await fetchEvmGasOracle(
    'eth',
    process.env.ETHERSCAN_API_KEY,
    priceUsd,
    20
  );

  const GAS_USED = 21_000;
  const feeFastUsd = feeUsdFromGwei(gas.fast, GAS_USED, priceUsd);
  const feeNormUsd = feeUsdFromGwei(gas.propose, GAS_USED, priceUsd);
  const feeSlowUsd = feeUsdFromGwei(gas.safe, GAS_USED, priceUsd);

  const tiers = [
    {
      tier: 'Fast',
      gasPrice: gas.fast,
      gasUnit: 'gwei',
      feeUSD: feeFastUsd,
      speedMinSec: 15,
      speedMaxSec: 60,
    },
    {
      tier: 'Normal',
      gasPrice: gas.propose,
      gasUnit: 'gwei',
      feeUSD: feeNormUsd,
      speedMinSec: 30,
      speedMaxSec: 300,
    },
    {
      tier: 'Slow',
      gasPrice: gas.safe,
      gasUnit: 'gwei',
      feeUSD: feeSlowUsd,
      speedMinSec: 60,
      speedMaxSec: 600,
    },
  ];

  const feeUSD = feeNormUsd;
  const speedSec = (tiers[1].speedMinSec + tiers[1].speedMaxSec) / 2;

  return {
    feeUSD,
    speedSec,
    status: classifyStatus(feeUSD, speedSec),
    updated: new Date().toISOString(),
    tieredSpeed: true,
    tiers,
  };
}

async function fetchArbitrumSnapshot(prices) {
  const priceUsd = prices.ARB || prices.ETH || 0; // ARBトークンが取れない場合は ETH USD を近似で使用
  if (!priceUsd) throw new Error('ARB price missing');

  const gas = await fetchEvmGasOracle(
    'arb',
    process.env.ARBISCAN_API_KEY,
    priceUsd,
    0.1
  );

  // L2 はガス使用量が小さいが、ここでは 21,000 をベースに近似
  const GAS_USED = 21_000;
  const feeFastUsd = feeUsdFromGwei(gas.fast, GAS_USED, priceUsd);
  const feeNormUsd = feeUsdFromGwei(gas.propose, GAS_USED, priceUsd);
  const feeSlowUsd = feeUsdFromGwei(gas.safe, GAS_USED, priceUsd);

  const tiers = [
    {
      tier: 'Fast',
      gasPrice: gas.fast,
      gasUnit: 'gwei',
      feeUSD: feeFastUsd,
      speedMinSec: 5,
      speedMaxSec: 20,
    },
    {
      tier: 'Normal',
      gasPrice: gas.propose,
      gasUnit: 'gwei',
      feeUSD: feeNormUsd,
      speedMinSec: 10,
      speedMaxSec: 60,
    },
    {
      tier: 'Slow',
      gasPrice: gas.safe,
      gasUnit: 'gwei',
      feeUSD: feeSlowUsd,
      speedMinSec: 30,
      speedMaxSec: 180,
    },
  ];

  const feeUSD = feeNormUsd;
  const speedSec = (tiers[1].speedMinSec + tiers[1].speedMaxSec) / 2;

  return {
    feeUSD,
    speedSec,
    status: classifyStatus(feeUSD, speedSec),
    updated: new Date().toISOString(),
    tieredSpeed: true,
    tiers,
  };
}

async function fetchOptimismSnapshot(prices) {
  const priceUsd = prices.OP || prices.ETH || 0;
  if (!priceUsd) throw new Error('OP price missing');

  const gas = await fetchEvmGasOracle(
    'op',
    process.env.OPTIMISTICSCAN_API_KEY,
    priceUsd,
    0.1
  );

  const GAS_USED = 21_000;
  const feeFastUsd = feeUsdFromGwei(gas.fast, GAS_USED, priceUsd);
  const feeNormUsd = feeUsdFromGwei(gas.propose, GAS_USED, priceUsd);
  const feeSlowUsd = feeUsdFromGwei(gas.safe, GAS_USED, priceUsd);

  const tiers = [
    {
      tier: 'Fast',
      gasPrice: gas.fast,
      gasUnit: 'gwei',
      feeUSD: feeFastUsd,
      speedMinSec: 5,
      speedMaxSec: 20,
    },
    {
      tier: 'Normal',
      gasPrice: gas.propose,
      gasUnit: 'gwei',
      feeUSD: feeNormUsd,
      speedMinSec: 10,
      speedMaxSec: 60,
    },
    {
      tier: 'Slow',
      gasPrice: gas.safe,
      gasUnit: 'gwei',
      feeUSD: feeSlowUsd,
      speedMinSec: 30,
      speedMaxSec: 180,
    },
  ];

  const feeUSD = feeNormUsd;
  const speedSec = (tiers[1].speedMinSec + tiers[1].speedMaxSec) / 2;

  return {
    feeUSD,
    speedSec,
    status: classifyStatus(feeUSD, speedSec),
    updated: new Date().toISOString(),
    tieredSpeed: true,
    tiers,
  };
}

// ===== Solana =====
//
// - getRecentPrioritizationFees で直近の prioritization fee（lamports）を取得
// - 基本手数料 5,000 lamports を加え、1 signature の転送を想定
// - 取得に失敗したら固定近似（非常に小さい fee）で fallback

async function fetchSolanaSnapshot(prices) {
  const priceUsd = prices.SOL || 0;
  if (!priceUsd) throw new Error('SOL price missing');

  let avgPriorityLamports = 0;

  try {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getRecentPrioritizationFees',
      params: [],
    };

    const json = await safeJsonFetch(
      SOLANA_RPC_URL,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      },
      'solana-prio-fees'
    );

    const arr = Array.isArray(json.result) ? json.result : [];
    if (arr.length > 0) {
      const sum = arr.reduce(
        (acc, x) => acc + safeNumber(x.prioritizationFee),
        0
      );
      avgPriorityLamports = sum / arr.length;
    } else {
      avgPriorityLamports = 0;
    }
  } catch (err) {
    console.error('[sol] getRecentPrioritizationFees failed:', err);
    avgPriorityLamports = 0;
  }

  // ベース手数料（1 signature あたり 5,000 lamports）を仮定（公式ドキュメントのデフォルト値）
  const BASE_LAMPORTS = 5_000;

  const lamportsFast = BASE_LAMPORTS + avgPriorityLamports * 1.5;
  const lamportsNorm = BASE_LAMPORTS + avgPriorityLamports;
  const lamportsSlow = BASE_LAMPORTS + avgPriorityLamports * 0.5;

  function feeUsdFromLamports(lamports) {
    const sol = lamports / 1_000_000_000; // 1 SOL = 1e9 lamports
    return sol * priceUsd;
  }

  const feeFastUsd = feeUsdFromLamports(lamportsFast);
  const feeNormUsd = feeUsdFromLamports(lamportsNorm);
  const feeSlowUsd = feeUsdFromLamports(lamportsSlow);

  const tiers = [
    {
      tier: 'Fast',
      gasPrice: Math.round(lamportsFast),
      gasUnit: 'lamports',
      feeUSD: feeFastUsd,
      speedMinSec: 1,
      speedMaxSec: 5,
    },
    {
      tier: 'Normal',
      gasPrice: Math.round(lamportsNorm),
      gasUnit: 'lamports',
      feeUSD: feeNormUsd,
      speedMinSec: 5,
      speedMaxSec: 20,
    },
    {
      tier: 'Slow',
      gasPrice: Math.round(lamportsSlow),
      gasUnit: 'lamports',
      feeUSD: feeSlowUsd,
      speedMinSec: 20,
      speedMaxSec: 60,
    },
  ];

  const feeUSD = feeNormUsd;
  const speedSec = (tiers[1].speedMinSec + tiers[1].speedMaxSec) / 2;

  return {
    feeUSD,
    speedSec,
    status: classifyStatus(feeUSD, speedSec),
    updated: new Date().toISOString(),
    tieredSpeed: true,
    tiers,
  };
}

// ===== メイン handler =====

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const prices = await fetchPricesUSD();

    const [btc, eth, arb, op, sol] = await Promise.all([
      fetchBitcoinSnapshot(prices),
      fetchEthereumSnapshot(prices),
      fetchArbitrumSnapshot(prices),
      fetchOptimismSnapshot(prices),
      fetchSolanaSnapshot(prices),
    ]);

    const payload = {
      bitcoin: btc,
      ethereum: eth,
      arbitrum: arb,
      optimism: op,
      solana: sol,
    };

    // app.js が毎分叩くので、軽いキャッシュをつける
    res.setHeader(
      'Cache-Control',
      's-maxage=30, stale-while-revalidate=60'
    );
    res.status(200).json(payload);
  } catch (err) {
    console.error('[snapshot] fatal error:', err);
    res.status(500).json({ error: 'Failed to build snapshot' });
  }
}
