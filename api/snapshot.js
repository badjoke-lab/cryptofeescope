const chains = require('../config/chains');
const { fetchPriceUSD } = require('../lib/fetchPrice/price');
const { fetchBtcGas } = require('../lib/fetchGas/btc');
const { fetchEvmGas } = require('../lib/fetchGas/evm');
const { fetchL2Gas } = require('../lib/fetchGas/l2');
const { fetchSolanaGas } = require('../lib/fetchGas/solana');
const { fetchXrpGas } = require('../lib/fetchGas/xrp');
const { validateFee } = require('../lib/validate/validateFee');
const { calcSpeed } = require('../lib/calc/calcSpeed');
const { median } = require('../lib/utils/median');

async function getPrice(symbol) {
  const result = await fetchPriceUSD(symbol);
  return result;
}

async function getGasCandidates(chainKey, l1GasPriceGwei) {
  const chain = chains[chainKey];
  if (chain.type === 'btc') return await fetchBtcGas(chain);
  if (chain.type === 'evm') return await fetchEvmGas(chain);
  if (chain.type === 'l2') return await fetchL2Gas(chain, l1GasPriceGwei);
  if (chain.type === 'sol') return await fetchSolanaGas(chain);
  if (chain.type === 'xrp') return await fetchXrpGas(chain);
  throw new Error(`unsupported chain ${chainKey}`);
}

async function getL1GasPriceGwei() {
  const ethChain = chains.eth;
  const candidates = await fetchEvmGas(ethChain);
  const values = candidates.map(c => c.gasPriceGwei).filter(v => Number.isFinite(v));
  return median(values);
}

async function buildChain(chainKey, l1GasPriceGwei) {
  const chain = chains[chainKey];
  const price = await getPrice(chain.symbol);
  const gasCandidates = await getGasCandidates(chainKey, l1GasPriceGwei);
  const validated = validateFee(chainKey, price.priceUSD, gasCandidates);
  const speedSec = validated.primary ? calcSpeed(chainKey, validated.primary || gasCandidates[0]) : null;
  const status = price.status === 'api-failed' || validated.status === 'api-failed' ? 'api-failed' : 'ok';
  return {
    chain: chainKey,
    feeNative: validated.feeNative != null ? Number(validated.feeNative) : null,
    feeUSD: validated.feeUSD != null ? Number(validated.feeUSD) : null,
    priceUSD: price.priceUSD != null ? Number(price.priceUSD) : null,
    speedSec,
    status,
    updated: validated.updated,
  };
}

async function generateSnapshot() {
  const generatedAt = new Date().toISOString();
  const l1GasPriceGwei = await getL1GasPriceGwei().catch(() => null);
  const entries = await Promise.all(
    Object.keys(chains).map(async key => {
      const entry = await buildChain(key, l1GasPriceGwei);
      return [key, entry];
    })
  );
  return { generatedAt, chains: Object.fromEntries(entries) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const snapshot = await generateSnapshot();
    return res.status(200).json(snapshot);
  } catch (e) {
    const fallback = { generatedAt: new Date().toISOString(), chains: {} };
    return res.status(200).json(fallback);
  }
};

module.exports.generateSnapshot = generateSnapshot;
module.exports.__TESTING__ = { buildChain, getGasCandidates, getPrice, getL1GasPriceGwei };
