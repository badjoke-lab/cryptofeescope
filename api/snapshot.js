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
  let lastError = null;
  for (let i = 0; i < 2; i++) {
    try {
      return await fetchPriceUSD(symbol);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error(`price unavailable for ${symbol}`);
}

async function getGasCandidates(chainKey, l1GasPriceGwei) {
  const chain = chains[chainKey];
  let candidates = [];
  if (chain.type === 'btc') candidates = await fetchBtcGas(chain);
  else if (chain.type === 'evm') candidates = await fetchEvmGas(chain);
  else if (chain.type === 'l2') candidates = await fetchL2Gas(chain, l1GasPriceGwei);
  else if (chain.type === 'sol') candidates = await fetchSolanaGas(chain);
  else if (chain.type === 'xrp') candidates = await fetchXrpGas(chain);
  else throw new Error(`unsupported chain ${chainKey}`);

  if (!candidates.length) {
    const now = new Date().toISOString();
    if (chain.type === 'btc') candidates.push({ feeNative: (50 * 140) / 1e8, satPerVbyte: 50, updated: now, provider: 'fallback' });
    else if (chain.type === 'evm') candidates.push({ feeNative: (20 / 1e9) * chain.gasLimit, gasPriceGwei: 20, updated: now, provider: 'fallback' });
    else if (chain.type === 'l2') {
      const l1 = l1GasPriceGwei || 30;
      const l2Fee = (0.25 / 1e9) * (chain.gasLimitL2 || 65000);
      const l1Fee = (l1 / 1e9) * (chain.l1DataGas || 30000);
      candidates.push({ feeNative: l1Fee + l2Fee, gasPriceGwei: 0.25, l1GasPriceGwei: l1, updated: now, provider: 'fallback' });
    } else if (chain.type === 'sol') candidates.push({ feeNative: 5000 / 1e9, lamports: 5000, updated: now, provider: 'fallback' });
    else if (chain.type === 'xrp') candidates.push({ feeNative: 12 / 1e6, drops: 12, updated: now, provider: 'fallback' });
  }
  return candidates;
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
  const speedSec = calcSpeed(chainKey, validated.primary || gasCandidates[0]);
  return {
    chain: chainKey,
    feeNative: Number(validated.feeNative),
    feeUSD: Number(validated.feeUSD),
    priceUSD: Number(price.priceUSD),
    speedSec,
    status: validated.status,
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
