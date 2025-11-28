const ranges = require('../../config/ranges');
const { median, clamp, freshTimestamp } = require('../utils/median');

const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function attachUSD(candidate, priceUSD) {
  const feeNative = Number(candidate?.feeNative);
  const feeUSD = Number.isFinite(priceUSD) && Number.isFinite(feeNative) ? feeNative * priceUSD : null;
  return { ...candidate, priceUSD, feeUSD };
}

function medianCandidate(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => (a.feeUSD ?? a.feeNative) - (b.feeUSD ?? b.feeNative));
  return sorted[Math.floor(sorted.length / 2)];
}

function enforceRange(chainKey, feeUSD) {
  const { minUSD, maxUSD } = ranges[chainKey];
  return clamp(feeUSD, minUSD, maxUSD);
}

function normalizeCandidates(chainKey, rawCandidates, priceUSD) {
  const withUsd = (rawCandidates || []).map(c => attachUSD(c, priceUSD));
  const fresh = withUsd.filter(c => c && c.feeNative > 0 && freshTimestamp(c.updated, MAX_AGE_MS));
  const valid = fresh.filter(c => Number.isFinite(c.feeUSD));
  const ranged = valid.filter(c => {
    const bounded = enforceRange(chainKey, c.feeUSD);
    return bounded === c.feeUSD;
  });
  const nonFallback = ranged.filter(c => c.provider !== 'fallback');
  let status = nonFallback.length ? 'ok' : 'estimated';
  let primary = nonFallback.length ? medianCandidate(nonFallback) : null;

  if (!primary) {
    const sourcePool = ranged.length ? ranged : valid;
    const med = median(sourcePool.map(c => c.feeUSD));
    if (med != null) {
      const bounded = enforceRange(chainKey, med);
      const feeNative = priceUSD ? bounded / priceUSD : med;
      primary = {
        chain: chainKey,
        provider: sourcePool[0]?.provider || 'median',
        feeNative,
        feeUSD: bounded,
        priceUSD,
        updated: new Date().toISOString(),
      };
      status = 'estimated';
    }
  }

  if (primary && enforceRange(chainKey, primary.feeUSD) !== primary.feeUSD) {
    const bounded = enforceRange(chainKey, primary.feeUSD);
    primary = { ...primary, feeUSD: bounded, feeNative: priceUSD ? bounded / priceUSD : primary.feeNative };
    status = 'estimated';
  }

  return { candidates: withUsd, primary, status };
}

module.exports = { attachUSD, normalizeCandidates, enforceRange, MAX_AGE_MS };
