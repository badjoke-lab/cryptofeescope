const snapshot = require('../api/snapshot');

async function getAllFeeCandidates(chains) {
  const result = {};
  for (const c of chains) {
    try {
      const fn = snapshot.__TEST_buildChain;
      if (!fn) {
        result[c] = [];
        continue;
      }
      const prices = await snapshot.__TEST_prices?.();
      const { candidates } = await fn(c, prices || {}, null);
      result[c] = candidates || [];
    } catch (e) {
      result[c] = [{ key: `${c}:error`, provider: 'internal', ok: false, valueUSD: null, valueNative: null, reasonIfInvalid: e.message }];
    }
  }
  return result;
}

async function getAllSpeedCandidates(chains) {
  const result = {};
  for (const c of chains) {
    try {
      const fn = snapshot.__TEST_buildSpeed;
      result[c] = fn ? await fn(c) : [];
    } catch (e) {
      result[c] = [{ key: `${c}:error`, provider: 'internal', ok: false, value: null, reasonIfInvalid: e.message }];
    }
  }
  return result;
}

function median(values) {
  const arr = [...values].sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 0) return (arr[mid - 1] + arr[mid]) / 2;
  return arr[mid];
}

function deviation(values, center) {
  if (!center || !values.length) return null;
  const diffs = values.map(v => Math.abs(v - center));
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return avg;
}

function mad(values, center) {
  if (!center || !values.length) return null;
  const diffs = values.map(v => Math.abs(v - center)).sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  if (diffs.length === 0) return null;
  if (diffs.length % 2 === 0) return (diffs[mid - 1] + diffs[mid]) / 2;
  return diffs[mid];
}

module.exports = {
  getAllFeeCandidates,
  getAllSpeedCandidates,
  median,
  deviation,
  mad,
};
