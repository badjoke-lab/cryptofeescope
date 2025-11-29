const ranges = require('../../config/ranges');
const { freshTimestamp } = require('../utils/median');

const MAX_AGE_MS = 3 * 60 * 60 * 1000;

function attachUSD(candidate, priceUSD) {
  if (!candidate || !Number.isFinite(priceUSD)) return null;
  const feeNative = Number(candidate.feeNative);
  if (!Number.isFinite(feeNative) || feeNative <= 0) return null;
  const feeUSD = feeNative * priceUSD;
  return { ...candidate, priceUSD, feeUSD };
}

function withinRange(chainKey, feeUSD) {
  const range = ranges[chainKey];
  if (!range) return false;
  return Number.isFinite(feeUSD) && feeUSD >= range.minUSD && feeUSD <= range.maxUSD;
}

function normalizeCandidates(chainKey, rawCandidates, priceUSD) {
  const withUsd = (rawCandidates || []).map(c => attachUSD(c, priceUSD)).filter(Boolean);
  const fresh = withUsd.filter(c => freshTimestamp(c.updated, MAX_AGE_MS));
  const valid = fresh.filter(c => withinRange(chainKey, c.feeUSD));
  const primary = valid.length ? valid[0] : null;
  const status = primary ? 'ok' : 'api-failed';
  return { candidates: withUsd, primary, status };
}

module.exports = { attachUSD, normalizeCandidates, withinRange, MAX_AGE_MS };
