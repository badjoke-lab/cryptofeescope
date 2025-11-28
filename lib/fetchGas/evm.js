const { fetchJson, toNumber } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');

function gweiToNative(gwei) {
  const n = toNumber(gwei);
  return n ? n / 1e9 : null;
}

function buildCandidate(chain, provider, gasPriceGwei, gasLimit) {
  const gas = toNumber(gasPriceGwei);
  if (!gas || gas <= 0.01) return null;
  const limit = gasLimit || 65000;
  const feeNative = gweiToNative(gas) * limit;
  return {
    chain: chain.key,
    provider,
    gasPriceGwei: gas,
    gasLimit: limit,
    feeNative,
    updated: new Date().toISOString(),
  };
}

async function fromRpc(chain) {
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
      const candidate = buildCandidate(chain, rpcProviderLabel('rpc', rpc), gwei, chain.gasLimit);
      if (candidate) results.push(candidate);
    } catch (e) {
      // try next RPC
    }
  }
  return results;
}

async function fromEtherscan(chain) {
  const key = process.env.ETHERSCAN_KEY ? `&apikey=${process.env.ETHERSCAN_KEY}` : '';
  const url = `${chain.etherscan}${key}`;
  const json = await fetchJson(url);
  const gwei = json?.result?.ProposeGasPrice || json?.result?.SafeGasPrice || json?.result?.FastGasPrice;
  return buildCandidate(chain, 'etherscan', gwei, chain.gasLimit);
}

async function fetchEvmGas(chain) {
  const providers = [];
  try { providers.push(...(await fromRpc(chain))); } catch (e) {}
  try { providers.push(await fromEtherscan(chain)); } catch (e) {}
  return providers.filter(Boolean);
}

module.exports = { fetchEvmGas };
