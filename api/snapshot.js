const chains = require('../config/chains');
const { fetchPriceUSD } = require('../lib/fetchPrice/price');
const { fetchBtcGas } = require('../lib/fetchGas/btc');
const { fetchEvmGas } = require('../lib/fetchGas/evm');
const { fetchL2Gas } = require('../lib/fetchGas/l2');
const { fetchSolanaGas } = require('../lib/fetchGas/solana');
const { fetchXrpGas } = require('../lib/fetchGas/xrp');
const { validateFee } = require('../lib/validate/validateFee');
const { calcSpeed } = require('../lib/calc/calcSpeed');

async function getPrice(symbol) {
  return fetchPriceUSD(symbol);
}

async function getPrices() {
  const symbols = [...new Set(Object.values(chains).map(c => c.symbol))];
  const entries = await Promise.all(symbols.map(async sym => [sym, await getPrice(sym)]));
  return Object.fromEntries(entries);
}

async function getGasCandidates(chain) {
  if (chain.type === 'btc') return fetchBtcGas(chain);
  if (chain.type === 'evm') return fetchEvmGas(chain);
  if (chain.type === 'l2') return fetchL2Gas(chain);
  if (chain.type === 'sol') return fetchSolanaGas(chain);
  if (chain.type === 'xrp') return fetchXrpGas(chain);
  return [];
}

async function buildChain(chainKey, prices) {
  const chain = chains[chainKey];
  const price = prices[chain.symbol] || { priceUSD: null, status: 'api-failed', updated: new Date().toISOString() };
  const gasCandidates = await getGasCandidates(chain);
  const validated = validateFee(chainKey, price.priceUSD, gasCandidates);
  const speedSec = validated.primary ? calcSpeed(chainKey, validated.primary) : null;
  const status = price.status === 'ok' && validated.status === 'ok' ? 'ok' : 'api-failed';
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
  const prices = await getPrices();
  const entries = await Promise.all(
    Object.keys(chains).map(async key => {
      const entry = await buildChain(key, prices);
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
module.exports.__TESTING__ = { buildChain, getGasCandidates, getPrice, getPrices };
