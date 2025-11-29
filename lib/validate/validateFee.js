const { normalizeCandidates, MAX_AGE_MS } = require('../calc/calcFee');
const { freshTimestamp } = require('../utils/median');

function validateFee(chainKey, priceUSD, gasCandidates) {
  const { primary, candidates, status } = normalizeCandidates(chainKey, gasCandidates, priceUSD);
  if (!primary) {
    return {
      chain: chainKey,
      feeNative: null,
      feeUSD: null,
      priceUSD,
      status: status || 'api-failed',
      speedSec: null,
      updated: new Date().toISOString(),
      provider: null,
      candidates,
      primary,
    };
  }
  const updated = freshTimestamp(primary.updated, MAX_AGE_MS) ? primary.updated : new Date().toISOString();
  return {
    chain: chainKey,
    feeNative: Number(primary.feeNative),
    feeUSD: Number(primary.feeUSD),
    priceUSD: Number(primary.priceUSD),
    status: 'ok',
    speedSec: null,
    updated,
    provider: primary.provider || 'unknown',
    candidates,
    primary,
  };
}

module.exports = { validateFee };
