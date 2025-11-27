const { fetchJson, toNumber } = require('../utils/http');

function lamportsToSol(lamports) {
  const l = toNumber(lamports);
  return l ? l / 1e9 : null;
}

function buildCandidate(provider, lamports) {
  const val = toNumber(lamports);
  if (!val || val <= 0) return null;
  return {
    chain: 'sol',
    provider,
    lamports: val,
    feeNative: lamportsToSol(val),
    updated: new Date().toISOString(),
  };
}

async function fromRpc(rpc) {
  const body = { jsonrpc: '2.0', id: 1, method: 'getFees', params: [] };
  const json = await fetchJson(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const lamports = json?.result?.value?.feeCalculator?.lamportsPerSignature;
  return buildCandidate('rpc', lamports);
}

async function heuristic() {
  const lamports = 5000; // conservative default
  return buildCandidate('heuristic', lamports);
}

async function fetchSolanaGas(chain) {
  const results = [];
  try { results.push(await fromRpc(chain.rpc)); } catch (e) {}
  try { results.push(await heuristic()); } catch (e) {}
  return results.filter(Boolean);
}

module.exports = { fetchSolanaGas };
