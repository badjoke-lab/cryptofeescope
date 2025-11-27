function isValidEntry(entry) {
  if (!entry) return false;
  const required = ['chain', 'feeNative', 'feeUSD', 'priceUSD', 'speedSec', 'status', 'updated'];
  for (const key of required) {
    if (entry[key] == null) return false;
  }
  if (!['ok', 'estimated'].includes(entry.status)) return false;
  if (!Number.isFinite(entry.feeNative) || !Number.isFinite(entry.feeUSD)) return false;
  if (!Number.isFinite(entry.priceUSD)) return false;
  if (!Number.isFinite(entry.speedSec)) return false;
  return true;
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (!snapshot.generatedAt || !snapshot.chains) return false;
  return Object.values(snapshot.chains).every(isValidEntry);
}

module.exports = { isValidEntry, validateSnapshot };
