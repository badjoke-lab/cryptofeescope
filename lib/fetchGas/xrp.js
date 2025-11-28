const { fetchJson, toNumber } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');

function dropsToXrp(drops) {
  const d = toNumber(drops);
  return d ? d / 1e6 : null;
}

function buildCandidate(provider, drops) {
  const val = toNumber(drops);
  if (!val || val <= 0) return null;
  return {
    chain: 'xrp',
    provider,
    drops: val,
    feeNative: dropsToXrp(val),
    updated: new Date().toISOString(),
  };
}

async function fromRpc(chain) {
  const body = { method: 'fee', params: [{}] };
  const results = [];
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const drops = json?.result?.drops?.open_ledger || json?.result?.drops?.median_fee;
      const candidate = buildCandidate(rpcProviderLabel('xrpl', rpc), drops);
      if (candidate) results.push(candidate);
    } catch (e) {
      // try next rpc
    }
  }
  return results;
}

async function heuristic() {
  return buildCandidate('heuristic', 12);
}

async function fetchXrpGas(chain) {
  const results = [];
  try { results.push(...(await fromRpc(chain))); } catch (e) {}
  try { results.push(await heuristic()); } catch (e) {}
  return results.filter(Boolean);
}

module.exports = { fetchXrpGas };
