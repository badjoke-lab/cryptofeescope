const { normalizeCandidates, enforceRange, MAX_AGE_MS } = require('../calc/calcFee');
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
  const bounded = enforceRange(chainKey, primary.feeUSD);
  const feeUSD = bounded;
  const feeNative = priceUSD ? feeUSD / priceUSD : primary.feeNative;
  return {
    chain: chainKey,
    feeNative,
    feeUSD,
    priceUSD,
    status: 'ok',
    speedSec: null,
    updated,
    provider: primary.provider || 'unknown',
    candidates,
    primary,
  };
}

module.exports = { validateFee };
