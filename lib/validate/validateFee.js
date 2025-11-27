const { normalizeCandidates, enforceRange, MAX_AGE_MS } = require('../calc/calcFee');
const { freshTimestamp } = require('../utils/median');

function validateFee(chainKey, priceUSD, gasCandidates) {
  const { primary, candidates, status } = normalizeCandidates(chainKey, gasCandidates, priceUSD);
  if (!primary) {
    throw new Error(`no valid fee for ${chainKey}`);
  }
  const updated = freshTimestamp(primary.updated, MAX_AGE_MS) ? primary.updated : new Date().toISOString();
  const feeUSD = enforceRange(chainKey, primary.feeUSD);
  const feeNative = priceUSD ? feeUSD / priceUSD : primary.feeNative;
  return {
    chain: chainKey,
    feeNative,
    feeUSD,
    priceUSD,
    status: status || 'ok',
    speedSec: null,
    updated,
    provider: primary.provider || 'unknown',
    candidates,
    primary,
  };
}

module.exports = { validateFee };
