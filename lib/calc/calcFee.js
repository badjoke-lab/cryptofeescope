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
  if (!Number.isFinite(feeUSD)) return null;
  return clamp(feeUSD, minUSD, maxUSD);
}

function normalizeCandidates(chainKey, rawCandidates, priceUSD) {
  const withUsd = (rawCandidates || []).map(c => attachUSD(c, priceUSD));
  if (!Number.isFinite(priceUSD)) {
    return { candidates: withUsd, primary: null, status: 'api-failed' };
  }
  const fresh = withUsd.filter(c => c && c.feeNative > 0 && freshTimestamp(c.updated, MAX_AGE_MS));
  const valid = fresh.filter(c => Number.isFinite(c.feeUSD));
  const adjusted = valid
    .map(c => {
      const bounded = enforceRange(chainKey, c.feeUSD);
      if (!Number.isFinite(bounded)) return null;
      const rangeAdjusted = bounded !== c.feeUSD;
      return {
        ...c,
        feeUSD: bounded,
        feeNative: c.priceUSD ? bounded / c.priceUSD : c.feeNative,
        rangeAdjusted,
      };
    })
    .filter(Boolean);

  const primary = medianCandidate(adjusted);
  const status = primary ? 'ok' : 'api-failed';
  return { candidates: withUsd, primary, status };
}

module.exports = { attachUSD, normalizeCandidates, enforceRange, MAX_AGE_MS };
