const { fetchJson, toNumber } = require('../utils/http');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');

function validGwei(value) {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 10000) return null;
  return n;
}

function gweiToNative(gwei) {
  const n = validGwei(gwei);
  return n ? n / 1e9 : null;
}

function baseLimits(chain) {
  return {
    nativeLimit: chain.gasLimitL2Native || 21000,
    tokenLimit: chain.gasLimitL2Token || chain.gasLimitL2 || 65000,
  };
}

function buildCandidate(chain, provider, gasPriceGwei, l1GasPriceGwei, l1DataGas, limitOverride, fallbackL1FeeNative) {
  const l2Price = validGwei(gasPriceGwei);
  if (!l2Price) return null;
  const limits = baseLimits(chain);
  const gasLimit = limitOverride || limits.nativeLimit;
  const l1Data = l1DataGas || chain.l1DataGas || 30000;
  const l1Price = validGwei(l1GasPriceGwei) || null;
  const l2Fee = gweiToNative(l2Price) * gasLimit;
  const l1Fee = l1Price ? gweiToNative(l1Price) * l1Data : fallbackL1FeeNative || 0;
  const feeNative = l2Fee + l1Fee;
  return {
    chain: chain.key,
    provider,
    gasPriceGwei: l2Price,
    l1GasPriceGwei: l1Price,
    gasLimit,
    l1DataGas: l1Data,
    feeNative,
    updated: new Date().toISOString(),
  };
}

async function fetchRpcGasPrice(chain) {
  const body = { jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] };
  const results = [];
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const wei = json?.result ? parseInt(json.result, 16) : null;
      const gwei = wei ? wei / 1e9 : null;
      const limits = baseLimits(chain);
      if (gwei != null) {
        results.push({ provider: rpcProviderLabel('rpc', rpc), gasPriceGwei: gwei, gasLimit: limits.nativeLimit });
        results.push({ provider: rpcProviderLabel('rpc-token', rpc), gasPriceGwei: gwei, gasLimit: limits.tokenLimit });
      }
    } catch (e) {
      // continue
    }
  }
  return results;
}

async function fetchRollupGasPrice(chain) {
  const results = [];
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'rollup_gasPrices', params: [] }),
      });
      const l1Wei = json?.result?.l1GasPrice ? parseInt(json.result.l1GasPrice, 16) : null;
      const l2Wei = json?.result?.l2GasPrice ? parseInt(json.result.l2GasPrice, 16) : null;
      const l1DataWei = json?.result?.l1DataFee ?? json?.result?.l1Fee;
      const l1Data = l1DataWei ? parseInt(l1DataWei, 16) : null;
      const l1GasPriceGwei = l1Wei ? l1Wei / 1e9 : null;
      const gasPriceGwei = l2Wei ? l2Wei / 1e9 : null;
      const limits = baseLimits(chain);
      const l1DataGas = l1Data && l1Wei ? Math.max(Math.round(l1Data / l1Wei), 20000) : null;
      const nativeCandidate = buildCandidate(chain, rpcProviderLabel('rollup', rpc), gasPriceGwei, l1GasPriceGwei, l1DataGas, limits.nativeLimit);
      const tokenCandidate = buildCandidate(chain, rpcProviderLabel('rollup-token', rpc), gasPriceGwei, l1GasPriceGwei, l1DataGas, limits.tokenLimit);
      if (nativeCandidate) results.push(nativeCandidate);
      if (tokenCandidate) results.push(tokenCandidate);
    } catch (e) {
      // continue
    }
  }
  return results;
}

async function fetchArbitrumL1Price(chain) {
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
      });
      const baseFee = json?.result?.baseFeePerGas ? parseInt(json.result.baseFeePerGas, 16) : null;
      if (baseFee) return baseFee / 1e9;
    } catch (e) {}
  }
  return null;
}

function fallbackL1FeeNative(chain) {
  if (chain.key === 'arb') return 0.000015; // ETH amount documented fallback
  return 0.000012; // ETH amount documented fallback for OP/Base
}

async function fetchL2Gas(chain, l1GasPriceGwei) {
  const candidates = [];
  let l1Price = validGwei(l1GasPriceGwei);
  if (!l1Price && chain.key === 'arb') {
    l1Price = await fetchArbitrumL1Price(chain);
  }

  if (!l1Price && chain.key !== 'arb') {
    const rollupPrices = await fetchRollupGasPrice(chain);
    if (rollupPrices.length) {
      return rollupPrices;
    }
  }

  const rpcCandidates = await fetchRpcGasPrice(chain);
  if (rpcCandidates.length) {
    rpcCandidates.forEach(c => {
      const candidate = buildCandidate(chain, c.provider, c.gasPriceGwei, l1Price, chain.l1DataGas, c.gasLimit);
      if (candidate) candidates.push(candidate);
    });
  }

  if (!candidates.length) {
    const fallbackFeeNative = fallbackL1FeeNative(chain);
    const limits = baseLimits(chain);
    const fallbackNative = buildCandidate(chain, 'l1-fallback-native', 0.5, null, chain.l1DataGas, limits.nativeLimit, fallbackFeeNative);
    const fallbackToken = buildCandidate(chain, 'l1-fallback-token', 0.5, null, chain.l1DataGas, limits.tokenLimit, fallbackFeeNative);
    if (fallbackNative) candidates.push(fallbackNative);
    if (fallbackToken) candidates.push(fallbackToken);
  }

  return candidates;
}

module.exports = { fetchL2Gas };
