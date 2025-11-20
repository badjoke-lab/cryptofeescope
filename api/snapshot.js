// /api/snapshot.js  — 完全版（Ethereum / Bitcoin / Arbitrum / Optimism / Solana 公式API）

export default async function handler(req, res) {
  try {
    // ---- 1. ETHERSCAN（Ethereum L1）
    const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
    const ethGas = await fetch(
      `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_KEY}`
    ).then(r => r.json());

    const ethResult = ethGas.result;
    const ethBaseGwei = parseFloat(ethResult.SafeGasPrice);

    // USD 価格取得（CoinGecko）
    const ethPrice = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    ).then(r => r.json());

    const ethUsd = ethPrice.ethereum.usd;
    const ethFeeUsd = (ethBaseGwei * 21000 * 1e-9 * ethUsd);

    // ---- 2. BITCOIN（mempool.space）
    const btcMempool = await fetch(
      "https://mempool.space/api/v1/fees/recommended"
    ).then(r => r.json());

    const btcFeerateSat = btcMempool.minimumFee;
    const btcByteSize = 250; // average tx
    const btcFeeUsd = (btcFeerateSat * btcByteSize * 1e-8) *
      (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")
        .then(r => r.json())
        .then(p => p.bitcoin.usd));

    const btcSpeedSec = btcMempool.halfHourFee ? 600 : 900;

    // ---- 3. ARBITRUM（Arbiscan → Etherscan API v2 互換）
    const ARB_KEY = process.env.ETHERSCAN_API_KEY;
    const arbGas = await fetch(
      `https://api.arbiscan.io/api?module=proxy&action=eth_gasPrice&apikey=${ARB_KEY}`
    ).then(r => r.json());

    const arbGasWei = parseInt(arbGas.result, 16);
    const arbGasGwei = arbGasWei / 1e9;

    const arbPrice = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    ).then(r => r.json());

    const arbFeeUsd = arbGasGwei * 21000 * 1e-9 * arbPrice.ethereum.usd;

    // ---- 4. OPTIMISM（OPscan → Etherscan互換）
    const opGas = await fetch(
      `https://api-optimistic.etherscan.io/api?module=proxy&action=eth_gasPrice&apikey=${ETHERSCAN_KEY}`
    ).then(r => r.json());

    const opGasWei = parseInt(opGas.result, 16) * 1.05; // OP L1 data overhead
    const opGasGwei = opGasWei / 1e9;

    const opPrice = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    ).then(r => r.json());

    const opFeeUsd = opGasGwei * 21000 * 1e-9 * opPrice.ethereum.usd;

    // ---- 5. SOLANA（RPC）
    const SOL_RPC = process.env.SOLANA_RPC_URL;
    const solFees = await fetch(`${SOL_RPC}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getFees"
      })
    }).then(r => r.json());

    const solPrice = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
    ).then(r => r.json());

    const solLamportsPerSig = solFees.result.value.feeCalculator.lamportsPerSignature;
    const solFeeUsd = (solLamportsPerSig * 1e-9) * solPrice.solana.usd;

    // ---- 返却 ----

    res.status(200).json({
      bitcoin: {
        feeUSD: btcFeeUsd,
        speedSec: btcSpeedSec,
        updated: Date.now()
      },
      ethereum: {
        feeUSD: ethFeeUsd,
        speedSec: 45,
        updated: Date.now()
      },
      arbitrum: {
        feeUSD: arbFeeUsd,
        speedSec: 8,
        updated: Date.now()
      },
      optimism: {
        feeUSD: opFeeUsd,
        speedSec: 10,
        updated: Date.now()
      },
      solana: {
        feeUSD: solFeeUsd,
        speedSec: 3,
        updated: Date.now()
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
}
