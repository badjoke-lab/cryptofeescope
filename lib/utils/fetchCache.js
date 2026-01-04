const CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const cacheStore = new Map();
const metaState = {
  lastFetchError: null,
  lastFetchErrorAt: null,
  lastFetchFailureKey: null,
  fetchFailures: [],
  cacheUsed: false,
  cacheAgeMinutes: null,
  cacheKey: null,
  lastCacheUsedAt: null,
};

function setCache(key, data) {
  const cachedAt = new Date().toISOString();
  cacheStore.set(key, {
    data,
    cachedAt,
    cachedAtMs: Date.now(),
  });
  return cachedAt;
}

function getFreshCache(key, maxAgeMs = CACHE_MAX_AGE_MS) {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  const ageMs = Date.now() - entry.cachedAtMs;
  if (ageMs > maxAgeMs) return null;
  return { ...entry, ageMs };
}

function recordFetchError(key, err) {
  const message = err instanceof Error ? err.message : String(err);
  const at = new Date().toISOString();
  metaState.lastFetchError = message;
  metaState.lastFetchErrorAt = at;
  metaState.lastFetchFailureKey = key;
  metaState.fetchFailures = [
    { key, message, at },
    ...metaState.fetchFailures.filter(entry => entry.key !== key),
  ].slice(0, 5);
}

function recordCacheUsage(key, ageMs) {
  metaState.cacheUsed = true;
  metaState.cacheAgeMinutes = Math.round(ageMs / 60000);
  metaState.cacheKey = key;
  metaState.lastCacheUsedAt = new Date().toISOString();
}

function getFetchMeta() {
  return {
    lastFetchError: metaState.lastFetchError,
    lastFetchErrorAt: metaState.lastFetchErrorAt,
    lastFetchFailureKey: metaState.lastFetchFailureKey,
    fetchFailures: metaState.fetchFailures,
    cacheUsed: metaState.cacheUsed,
    cacheAgeMinutes: metaState.cacheAgeMinutes,
    cacheKey: metaState.cacheKey,
    lastCacheUsedAt: metaState.lastCacheUsedAt,
  };
}

module.exports = {
  CACHE_MAX_AGE_MS,
  setCache,
  getFreshCache,
  recordFetchError,
  recordCacheUsage,
  getFetchMeta,
};
