const { fetchJson } = require('../utils/http');
const { tryAll } = require('../utils/fallback');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');

const L2_LIMITS = { min: 0.01, max: 5 };
const L1_LIMITS = { min: 1, max: 200 };

const FALLBACK_L1_GWEI = { arb: 15, op: 12, base: 12 };
const ARB_SEQUENCER_RPC = 'https://arb1-sequencer.arbitrum.io/rpc';
const ARB_GAS_LIMIT = 70000;
const ARB_L1_DATA_GAS = 1000;
const ARB_FALLBACK_L2_GWEI = 0.25;
const ARB_FALLBACK_L1_DATA_ETH = 0.000015;
const ARB_FALLBACK_PROVIDER = 'arb-static';

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

function arbBuildCandidate(provider, gasPriceGwei, l1DataPriceEth) {
  const gasPrice = validL2GasPrice(gasPriceGwei);
  const l1DataPrice = Number(l1DataPriceEth);
  if (!gasPrice) return null;
  if (!Number.isFinite(l1DataPrice) || l1DataPrice <= 0) return null;
  const feeNative = gasPrice / 1e9 * ARB_GAS_LIMIT + l1DataPrice;
  return {
    chain: 'arb',
    provider,
    gasPriceGwei: gasPrice,
    l1DataPrice,
    gasLimit: ARB_GAS_LIMIT,
    feeNative,
    updated: new Date().toISOString(),
  };
}

async function fetchRpcGasAndBase(rpc, provider, timeout) {
  const [gasPriceRes, blockRes] = await Promise.all([
    fetchJson(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'eth_gasPrice', params: [] }),
      timeout,
    }),
    fetchJson(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'eth_getBlockByNumber', params: ['latest', false] }),
      timeout,
    }),
  ]);

  const gasPriceWei = gasPriceRes?.result ? parseInt(gasPriceRes.result, 16) : null;
  const baseFeeWei = blockRes?.result?.baseFeePerGas ? parseInt(blockRes.result.baseFeePerGas, 16) : null;
  const gasPriceGwei = gasPriceWei ? gasPriceWei / 1e9 : null;
  const baseFeeGwei = baseFeeWei ? baseFeeWei / 1e9 : null;
  const l1DataPrice = baseFeeGwei ? (baseFeeGwei / 1e9) * ARB_L1_DATA_GAS : null;
  return { gasPriceGwei, l1DataPrice, provider };
}

async function fetchArbiscanGas(timeout) {
  const key = process.env.ARBISCAN_KEY ? `&apikey=${process.env.ARBISCAN_KEY}` : '';
  const url = `https://api.arbiscan.io/api?module=proxy&action=eth_gasPrice${key}`;
  const json = await fetchJson(url, { timeout });
  const gasPriceWei = json?.result ? parseInt(json.result, 16) : null;
  const gasPriceGwei = gasPriceWei ? gasPriceWei / 1e9 : null;
  return { gasPriceGwei, l1DataPrice: null, provider: 'arbiscan' };
}

async function fetchEthL1DataPrice(timeout) {
  const rpc = 'https://rpc.ankr.com/eth';
  const block = await fetchJson(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'eth_getBlockByNumber', params: ['latest', false] }),
    timeout,
  });
  const baseFeeWei = block?.result?.baseFeePerGas ? parseInt(block.result.baseFeePerGas, 16) : null;
  const baseFeeGwei = baseFeeWei ? baseFeeWei / 1e9 : null;
  const l1DataPrice = baseFeeGwei ? (baseFeeGwei / 1e9) * ARB_L1_DATA_GAS : null;
  return { gasPriceGwei: null, l1DataPrice, provider: 'eth-basefee' };
}

function arbStaticFallback() {
  return {
    gasPriceGwei: ARB_FALLBACK_L2_GWEI,
    l1DataPrice: ARB_FALLBACK_L1_DATA_ETH,
    provider: ARB_FALLBACK_PROVIDER,
  };
}

async function fetchArbGas(chain) {
  const timeout = 800;
  const layers = [
    async () => fetchRpcGasAndBase(chain.rpc?.[0], rpcProviderLabel('arb1', chain.rpc?.[0]), timeout),
    async () => fetchRpcGasAndBase(ARB_SEQUENCER_RPC, 'arb-sequencer', timeout),
    async () => fetchArbiscanGas(timeout),
    async () => fetchEthL1DataPrice(timeout),
    async () => arbStaticFallback(),
  ];

  let l2GasPrice;
  let l1DataPrice;
  let provider = 'arb-multi';
  let gasLimit = ARB_GAS_LIMIT;

  for (const layer of layers) {
    try {
      const res = await layer();
      if (!res) continue;
      if (!l2GasPrice) l2GasPrice = validL2GasPrice(res.gasPriceGwei);
      if (!l1DataPrice) {
        const val = Number(res.l1DataPrice);
        l1DataPrice = Number.isFinite(val) && val > 0 ? val : null;
      }
      if (!gasLimit) gasLimit = ARB_GAS_LIMIT;
      if (res.provider) provider = res.provider;
      if (l2GasPrice && l1DataPrice) break;
    } catch (e) {
      // move to next layer
    }
  }

  if (!validL2GasPrice(l2GasPrice)) l2GasPrice = ARB_FALLBACK_L2_GWEI;
  if (!Number.isFinite(l1DataPrice) || l1DataPrice <= 0) l1DataPrice = ARB_FALLBACK_L1_DATA_ETH;
  if (!Number.isFinite(gasLimit) || gasLimit <= 0) gasLimit = ARB_GAS_LIMIT;

  const feeNative = (l2GasPrice / 1e9) * gasLimit + l1DataPrice;
  const safeFeeNative = Number.isFinite(feeNative) && feeNative > 0
    ? feeNative
    : (ARB_FALLBACK_L2_GWEI / 1e9) * ARB_GAS_LIMIT + ARB_FALLBACK_L1_DATA_ETH;

  const candidate = arbBuildCandidate(provider, l2GasPrice, l1DataPrice) ||
    arbBuildCandidate(ARB_FALLBACK_PROVIDER, ARB_FALLBACK_L2_GWEI, ARB_FALLBACK_L1_DATA_ETH);

  if (candidate) {
    candidate.gasLimit = gasLimit;
    candidate.feeNative = safeFeeNative;
  }

  return candidate ? [candidate] : [];
}

async function fetchL2Gas(chain) {
  if (chain.key === 'arb') return fetchArbGas(chain);
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
