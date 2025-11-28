const { fetchJson, toNumber } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');
const { median } = require('../utils/median');

function validGasPrice(gwei) {
  const n = toNumber(gwei);
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n >= 10000) return null;
  return n;
}

function gweiToNative(gwei) {
  const n = validGasPrice(gwei);
  return n ? n / 1e9 : null;
}

function buildCandidate(chain, provider, gasPriceGwei, gasLimit) {
  const gas = validGasPrice(gasPriceGwei);
  if (!gas) return null;
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
  const { result } = json || {};
  const values = [result?.SafeGasPrice, result?.ProposeGasPrice, result?.FastGasPrice]
    .map(toNumber)
    .filter(v => validGasPrice(v));
  if (!values.length) return null;
  const gas = chain.key === 'bsc' ? median(values) : values[1] || values[0];
  return buildCandidate(chain, 'etherscan', gas, chain.gasLimit);
}

async function fromEtherchain(chain) {
  if (chain.key !== 'eth') return null;
  const json = await fetchJson('https://beaconcha.in/api/v1/execution/gasnow');
  const wei = json?.data?.standard;
  const gwei = wei ? Number(wei) / 1e9 : null;
  return buildCandidate(chain, 'beaconcha.in', gwei, chain.gasLimit);
}

async function defaultGas(chain) {
  if (chain.key === 'avax' || chain.key === 'polygon') {
    return buildCandidate(chain, 'default-30-gwei', 30, chain.gasLimit);
  }
  return null;
}

async function fetchEvmGas(chain) {
  const providers = [];
  try {
    const etherscan = await fromEtherscan(chain);
    if (etherscan) providers.push(etherscan);
  } catch (e) {}
  try { providers.push(...(await fromRpc(chain))); } catch (e) {}
  if (chain.key === 'eth') {
    try {
      const etherchain = await fromEtherchain(chain);
      if (etherchain) providers.push(etherchain);
    } catch (e) {}
  }
  if ((chain.key === 'avax' || chain.key === 'polygon') && !providers.length) {
    const fallback = await defaultGas(chain);
    if (fallback) providers.push(fallback);
  }
  return providers.filter(Boolean);
}

module.exports = { fetchEvmGas };
