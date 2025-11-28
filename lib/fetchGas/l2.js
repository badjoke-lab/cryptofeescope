const { fetchJson, toNumber } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');

function gweiToNative(gwei) {
  const n = toNumber(gwei);
  return n ? n / 1e9 : null;
}

function buildCandidate(chain, provider, gasPriceGwei, l1GasPriceGwei) {
  const l2Price = toNumber(gasPriceGwei);
  if (!l2Price || l2Price <= 0.01) return null;
  const gasLimit = chain.gasLimitL2 || 65000;
  const l1DataGas = chain.l1DataGas || 30000;
  const l1Price = toNumber(l1GasPriceGwei) || 0;
  const l2Fee = gweiToNative(l2Price) * gasLimit;
  const l1Fee = gweiToNative(l1Price) * l1DataGas;
  const feeNative = l2Fee + l1Fee;
  return {
    chain: chain.key,
    provider,
    gasPriceGwei: l2Price,
    l1GasPriceGwei: l1Price,
    gasLimit,
    l1DataGas,
    feeNative,
    updated: new Date().toISOString(),
  };
}

async function fromRpc(chain, l1GasPriceGwei) {
  const body = { jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] };
  const results = [];
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const hex = json?.result;
      const value = hex ? parseInt(hex, 16) : null;
      const gwei = value ? value / 1e9 : null;
      const candidate = buildCandidate(chain, rpcProviderLabel('rpc', rpc), gwei, l1GasPriceGwei);
      if (candidate) results.push(candidate);
    } catch (e) {
      // try next rpc
    }
  }
  return results;
}

async function fromHeuristic(chain, rpcGas, l1GasPriceGwei) {
  const boosted = rpcGas ? rpcGas * 1.1 : 0.15;
  return buildCandidate(chain, 'heuristic', boosted, l1GasPriceGwei);
}

async function fetchL2Gas(chain, l1GasPriceGwei) {
  const results = [];
  let rpcCandidate = null;
  try {
    const rpcCandidates = await fromRpc(chain, l1GasPriceGwei);
    rpcCandidate = rpcCandidates[0] || null;
    results.push(...rpcCandidates);
  } catch (e) {}
  try {
    const fallback = await fromHeuristic(chain, rpcCandidate?.gasPriceGwei, l1GasPriceGwei);
    if (fallback) results.push(fallback);
  } catch (e) {}
  return results;
}

module.exports = { fetchL2Gas };
