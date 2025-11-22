/**
 * CryptoFeeScope Snapshot API
 * ETH RPC = https://eth.llamarpc.com へ変更（Cloudflare ETH から移行）
 */

const axios = require("axios");

// ---------------------
// Utility
// ---------------------
function baseFailedChain(nowIso, errorMessage = "") {
  return {
    ok: false,
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
    error: errorMessage,
  };
}

async function safeBuild(builder, generatedAt) {
  try {
    const result = await builder();
    return { ok: true, ...result };
  } catch (e) {
    console.error("[snapshot] chain failed:", e.message);
    const ts = generatedAt || new Date().toISOString();
    return baseFailedChain(ts, e.message || "error");
  }
}

// ---------------------
// Price Fetcher
// ---------------------
async function getPrices() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,matic-network,solana,arbitrum,optimism,base&vs_currencies=usd,jpy";
  const r = await axios.get(url);
  return {
    BTC: r.data.bitcoin,
    ETH: r.data.ethereum,
    BNB: r.data.binancecoin,
    MATIC: r.data["matic-network"],
    SOL: r.data.solana,
    ARB: r.data.arbitrum,
    OP: r.data.optimism,
    BASE: r.data.base
  };
}

// ---------------------
// RPC: ETH / ARB / OP / BASE / BSC
// ---------------------
async function getGasPriceFromRpc(rpcUrl) {
  const r = await axios.post(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_gasPrice",
    params: []
  });

  if (!r.data || !r.data.result) {
    throw new Error("RPC returned invalid gasPrice");
  }

  const hex = r.data.result;
  const gasWei = parseInt(hex, 16);
  if (!gasWei || isNaN(gasWei)) throw new Error("Invalid gasPrice from RPC");

  return gasWei; // in wei per gas
}

// ---------------------
// Builder (ETH)
// ---------------------
async function buildEthereum(prices) {
  const rpc = "https://eth.llamarpc.com";           // ← ここを Cloudflare → Llama に変更
  const gasWei = await getGasPriceFromRpc(rpc);
  const gasGwei = gasWei / 1e9;

  // ETH: Base fee calculation
  const gasLimit = 21000;
  const usdPerEth = prices.ETH.usd;
  const jpyPerEth = prices.ETH.jpy;

  const feeEth = (gasGwei * 1e-9) * gasLimit;
  const feeUSD = feeEth * usdPerEth;
  const feeJPY = feeEth * jpyPerEth;

  const now = new Date().toISOString();
  const speedSec = 120;

  return {
    feeUSD,
    feeJPY,
    speedSec,
    status: "fast",
    updated: now,
    tiers: [
      { label: "standard", feeUSD, feeJPY, speedSec },
      { label: "fast", feeUSD: feeUSD * 1.5, feeJPY: feeJPY * 1.5, speedSec: 30 },
      { label: "slow", feeUSD: feeUSD * 0.7, feeJPY: feeJPY * 0.7, speedSec: 300 }
    ]
  };
}

// ---------------------
// SOL
// ---------------------
async function buildSolana(prices) {
  const lamports = 5000; // typical
  const sol = lamports / 1e9;

  const feeUSD = sol * prices.SOL.usd;
  const feeJPY = sol * prices.SOL.jpy;

  const now = new Date().toISOString();
  return {
    feeUSD,
    feeJPY,
    speedSec: 10,
    status: "fast",
    updated: now,
    tiers: [
      { label: "standard", feeUSD, feeJPY, speedSec: 10 },
      { label: "fast", feeUSD, feeJPY, speedSec: 8 },
      { label: "slow", feeUSD, feeJPY, speedSec: 20 }
    ]
  };
}

// ---------------------
// BTC (mempool.space)
// ---------------------
async function buildBitcoin(prices) {
  const r = await axios.get("https://mempool.space/api/v1/fees/recommended");
  const sats = r.data.hourFee;
  const feeBtc = (sats * 250) / 1e8;

  const feeUSD = feeBtc * prices.BTC.usd;
  const feeJPY = feeBtc * prices.BTC.jpy;

  const now = new Date().toISOString();
  return {
    feeUSD,
    feeJPY,
    speedSec: 1800,
    status: "avg",
    updated: now,
    tiers: [
      { label: "standard", feeUSD, feeJPY, speedSec: 1800 },
      { label: "fast", feeUSD: feeUSD * 2, feeJPY: feeJPY * 2, speedSec: 600 },
      { label: "slow", feeUSD, feeJPY, speedSec: 3600 }
    ]
  };
}

// ---------------------
// Generic EVM Chains (ARB / OP / BASE / BSC)
// ---------------------
async function buildEvmGeneric(prices, rpcUrl, tokenPrice, gasLimit = 21000) {
  const gasWei = await getGasPriceFromRpc(rpcUrl);
  const gasGwei = gasWei / 1e9;
  const feeToken = (gasGwei * 1e-9) * gasLimit;

  const feeUSD = feeToken * tokenPrice.usd;
  const feeJPY = feeToken * tokenPrice.jpy;

  const now = new Date().toISOString();
  return {
    feeUSD,
    feeJPY,
    speedSec: 30,
    status: "fast",
    updated: now,
    tiers: [
      { label: "standard", feeUSD, feeJPY, speedSec: 30 },
      { label: "fast", feeUSD: feeUSD * 1.5, feeJPY: feeJPY * 1.5, speedSec: 10 },
      { label: "slow", feeUSD: feeUSD * 0.7, feeJPY: feeJPY * 0.7, speedSec: 60 }
    ]
  };
}

// ---------------------
// Main
// ---------------------
module.exports = async function (req, res) {
  const generatedAt = new Date().toISOString();

  try {
    const prices = await getPrices();

    const chains = {
      btc: await safeBuild(() => buildBitcoin(prices), generatedAt),

      eth: await safeBuild(() => buildEthereum(prices), generatedAt),

      sol: await safeBuild(() => buildSolana(prices), generatedAt),

      arb: await safeBuild(
        () => buildEvmGeneric(prices.ARB, "https://arb1.arbitrum.io/rpc", prices.ARB),
        generatedAt
      ),

      op: await safeBuild(
        () => buildEvmGeneric(prices.OP, "https://mainnet.optimism.io", prices.OP),
        generatedAt
      ),

      base: await safeBuild(
        () => buildEvmGeneric(prices.BASE, "https://mainnet.base.org", prices.BASE),
        generatedAt
      ),

      bsc: await safeBuild(
        () => buildEvmGeneric(prices.BNB, "https://bsc-dataseed.binance.org", prices.BNB),
        generatedAt
      ),

      polygon: await safeBuild(
        () => buildEvmGeneric(prices.MATIC, "https://polygon-rpc.com", prices.MATIC),
        generatedAt
      ),
    };

    return res.status(200).json({ generatedAt, chains });
  } catch (e) {
    console.error("[snapshot fatal]", e);
    return res.status(500).json({ error: e.message });
  }
};
