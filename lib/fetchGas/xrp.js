const { fetchJson, toNumber } = require('../utils/http');

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
  const json = await fetchJson(chain.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const drops = json?.result?.drops?.open_ledger || json?.result?.drops?.median_fee;
  return buildCandidate('xrpl', drops);
}

async function heuristic() {
  return buildCandidate('heuristic', 12);
}

async function fetchXrpGas(chain) {
  const results = [];
  try { results.push(await fromRpc(chain)); } catch (e) {}
  try { results.push(await heuristic()); } catch (e) {}
  return results.filter(Boolean);
}

module.exports = { fetchXrpGas };
