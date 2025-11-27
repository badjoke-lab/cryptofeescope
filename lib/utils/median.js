function median(values) {
  const arr = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return null;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function freshTimestamp(ts, maxAgeMs) {
  const date = typeof ts === 'string' ? new Date(ts) : ts instanceof Date ? ts : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= maxAgeMs;
}

module.exports = { median, clamp, freshTimestamp };
