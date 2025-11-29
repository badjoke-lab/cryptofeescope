const { fetchJson } = require('../utils/http');
const { tryAll } = require('../utils/fallback');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');

const L2_LIMITS = { min: 0.01, max: 5 };
const L1_LIMITS = { min: 1, max: 200 };

const FALLBACK_L1_GWEI = { arb: 15, op: 12, base: 12 };

function validL2GasPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < L2_LIMITS.min || n > L2_LIMITS.max) return null;
  return n;
}

function validL1GasPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < L1_LIMITS.min || n > L1_LIMITS.max) return null;
  return n;
}

function buildCandidate(chain, provider, gasPriceGwei, l1GasPriceGwei, l1DataGas) {
  const l2 = validL2GasPrice(gasPriceGwei);
  const l1 = l1GasPriceGwei ? validL1GasPrice(l1GasPriceGwei) : null;
  if (!l2) return null;
  const gasLimit = chain.gasLimitL2 || 65000;
  const dataGas = l1DataGas || chain.l1DataGas || 30000;
  const l2Fee = (l2 / 1e9) * gasLimit;
  const l1Fee = l1 ? (l1 / 1e9) * dataGas : 0;
  return {
    chain: chain.key,
    provider,
    gasPriceGwei: l2,
    l1GasPriceGwei: l1,
    gasLimit,
    l1DataGas: dataGas,
    feeNative: l2Fee + l1Fee,
    updated: new Date().toISOString(),
  };
}

async function rollupGasPrices(chain, timeout) {
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'rollup_gasPrices', params: [] }),
        timeout,
      });
      const l2Wei = json?.result?.l2GasPrice ? parseInt(json.result.l2GasPrice, 16) : null;
      const l1Wei = json?.result?.l1GasPrice ? parseInt(json.result.l1GasPrice, 16) : null;
      const l1DataWei = json?.result?.l1DataFee || json?.result?.l1Fee;
      const l1Data = l1DataWei ? parseInt(l1DataWei, 16) : null;
      const l1DataGas = l1Data && l1Wei ? Math.max(Math.round(l1Data / l1Wei), chain.l1DataGas || 30000) : chain.l1DataGas;
      const cand = buildCandidate(chain, rpcProviderLabel('rollup', rpc), l2Wei ? l2Wei / 1e9 : null, l1Wei ? l1Wei / 1e9 : null, l1DataGas);
      if (cand) return cand;
    } catch (e) {
      // try next
    }
  }
  return null;
}

async function rpcGasPrice(chain, timeout) {
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] }),
        timeout,
      });
      const wei = json?.result ? parseInt(json.result, 16) : null;
      const gwei = wei ? wei / 1e9 : null;
      const cand = buildCandidate(chain, rpcProviderLabel('rpc', rpc), gwei, null, chain.l1DataGas);
      if (cand) return cand;
    } catch (e) {
      // continue
    }
  }
  return null;
}

async function fetchEthBaseFee(timeout) {
  const rpc = 'https://rpc.ankr.com/eth';
  try {
    const block = await fetchJson(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_getBlockByNumber', params: ['latest', false] }),
      timeout,
    });
    const base = block?.result?.baseFeePerGas ? parseInt(block.result.baseFeePerGas, 16) : null;
    return base ? base / 1e9 : null;
  } catch (e) {
    return null;
  }
}

async function rpcWithEthBase(chain, timeout) {
  const base = await fetchEthBaseFee(timeout);
  if (!base) return null;
  const l1GasPrice = validL1GasPrice(base);
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'eth_gasPrice', params: [] }),
        timeout,
      });
      const wei = json?.result ? parseInt(json.result, 16) : null;
      const gwei = wei ? wei / 1e9 : null;
      const cand = buildCandidate(chain, rpcProviderLabel('rpc-l1-base', rpc), gwei, l1GasPrice, chain.l1DataGas);
      if (cand) return cand;
    } catch (e) {}
  }
  return null;
}

function staticFallback(chain) {
  const l2 = validL2GasPrice(0.5);
  const l1 = validL1GasPrice(FALLBACK_L1_GWEI[chain.key] || 12);
  return buildCandidate(chain, 'static-fallback', l2, l1, chain.l1DataGas || 30000);
}

async function fetchL2Gas(chain) {
  const timeout = 600;
  const providers = [
    () => rollupGasPrices(chain, timeout),
    () => rpcWithEthBase(chain, timeout),
    () => rpcGasPrice(chain, timeout),
    () => staticFallback(chain),
  ];

  const candidate = await tryAll(providers, timeout, 4000).catch(() => null);
  return candidate ? [candidate] : [];
}

module.exports = { fetchL2Gas, validL2GasPrice, validL1GasPrice };
