const { fetchJson } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');
const { CACHE_MAX_AGE_MS, setCache, getFreshCache, recordFetchError, recordCacheUsage } = require('../utils/fetchCache');

function buildCandidate(provider, lamports) {
  const val = Number(lamports);
  if (!Number.isFinite(val) || val <= 0) return null;
  return {
    chain: 'sol',
    provider,
    lamports: val,
    feeNative: val / 1e9,
    updated: new Date().toISOString(),
  };
}

async function fromRpc(rpc, timeout) {
  const body = { jsonrpc: '2.0', id: 1, method: 'getFees', params: [] };
  const json = await fetchJson(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout,
  });
  const lamports = json?.result?.value?.feeCalculator?.lamportsPerSignature;
  return buildCandidate(rpcProviderLabel('rpc', rpc), lamports);
}

function fallbackFixed() {
  return buildCandidate('static', 5000);
}

async function fetchSolanaGas(chain) {
  const timeout = 10000;
  const cacheKey = 'gas:sol';
  const providers = toRpcList(chain.rpc).map(rpc => () => fromRpc(rpc, timeout));
  providers.push(() => fallbackFixed());
  let lastError = null;
  for (const provider of providers) {
    try {
      const candidate = await provider();
      if (candidate) {
        const cachedAt = setCache(cacheKey, [candidate]);
        return [{ ...candidate, source: 'live', cachedAt }];
      }
    } catch (e) {
      lastError = e;
    }
  }
  recordFetchError(cacheKey, lastError || 'no solana gas candidate');
  const cached = getFreshCache(cacheKey, CACHE_MAX_AGE_MS);
  if (cached) {
    recordCacheUsage(cacheKey, cached.ageMs);
    return cached.data.map(entry => ({
      ...entry,
      source: 'cache',
      cachedAt: cached.cachedAt,
      cacheAgeMinutes: Math.round(cached.ageMs / 60000),
    }));
  }
  return [];
}

module.exports = { fetchSolanaGas };
