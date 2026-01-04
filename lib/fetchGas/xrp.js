const { fetchJson } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');
const { CACHE_MAX_AGE_MS, setCache, getFreshCache, recordFetchError, recordCacheUsage } = require('../utils/fetchCache');

function buildCandidate(provider, drops) {
  const val = Number(drops);
  if (!Number.isFinite(val) || val <= 0) return null;
  return {
    chain: 'xrp',
    provider,
    drops: val,
    feeNative: val / 1e6,
    updated: new Date().toISOString(),
  };
}

async function fromServerInfo(rpc, timeout) {
  const body = { method: 'server_info', params: [{}] };
  const json = await fetchJson(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout,
  });
  const drops = json?.result?.info?.validated_ledger?.base_fee_xrp
    ? Number(json.result.info.validated_ledger.base_fee_xrp) * 1e6
    : json?.result?.info?.validated_ledger?.reserve_base_xrp
    ? Number(json.result.info.validated_ledger.reserve_base_xrp) * 1e6
    : null;
  return buildCandidate(rpcProviderLabel('server_info', rpc), drops);
}

async function fromFee(rpc, timeout) {
  const body = { method: 'fee', params: [{}] };
  const json = await fetchJson(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout,
  });
  const drops = json?.result?.drops?.open_ledger || json?.result?.drops?.median_fee;
  return buildCandidate(rpcProviderLabel('fee', rpc), drops);
}

function fallbackHeuristic() {
  return buildCandidate('heuristic', 900);
}

async function fetchXrpGas(chain) {
  const timeout = 10000;
  const cacheKey = 'gas:xrp';
  const providers = [
    ...toRpcList(chain.rpc).map(rpc => () => fromServerInfo(rpc, timeout)),
    ...toRpcList(chain.rpc).map(rpc => () => fromFee(rpc, timeout)),
    () => fallbackHeuristic(),
  ];

  let lastError = null;
  for (const provider of providers) {
    try {
      const cand = await provider();
      if (cand) {
        const cachedAt = setCache(cacheKey, [cand]);
        return [{ ...cand, source: 'live', cachedAt }];
      }
    } catch (e) {
      lastError = e;
    }
  }

  recordFetchError(cacheKey, lastError || 'no xrp gas candidate');
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

module.exports = { fetchXrpGas };
