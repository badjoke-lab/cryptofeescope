const { fetchJson } = require('../utils/http');
const { tryAll } = require('../utils/fallback');
const { toRpcList, rpcProviderLabel } = require('../utils/rpc');
const { median } = require('../utils/median');

const GAS_PRICE_LIMITS = {
  eth: { min: 0.1, max: 500 },
  bsc: { min: 1, max: 50 },
  polygon: { min: 1, max: 500 },
  avax: { min: 1, max: 500 },
};

function validGasPrice(chain, value) {
  const limits = GAS_PRICE_LIMITS[chain.key] || { min: 0.1, max: 500 };
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < limits.min || n > limits.max) return null;
  return n;
}

function gweiToNative(gwei) {
  return Number(gwei) / 1e9;
}

function buildCandidate(chain, provider, gasPriceGwei) {
  const gasPrice = validGasPrice(chain, gasPriceGwei);
  if (!gasPrice) return null;
  const gasLimit = chain.gasLimit || 65000;
  return {
    chain: chain.key,
    provider,
    gasPriceGwei: gasPrice,
    gasLimit,
    feeNative: gweiToNative(gasPrice) * gasLimit,
    updated: new Date().toISOString(),
  };
}

async function fromEtherscan(chain, timeout) {
  const key = process.env.ETHERSCAN_KEY ? `&apikey=${process.env.ETHERSCAN_KEY}` : '';
  const url = `${chain.etherscan}${key}`;
  const json = await fetchJson(url, { timeout });
  const { result } = json || {};
  const values = [result?.FastGasPrice, result?.ProposeGasPrice, result?.SafeGasPrice]
    .map(v => validGasPrice(chain, v))
    .filter(Boolean);
  const gas = values.length ? values[0] : null;
  return buildCandidate(chain, 'etherscan', gas);
}

async function rpcGasPrice(chain, timeout) {
  const body = { jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] };
  for (const rpc of toRpcList(chain.rpc)) {
    try {
      const json = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeout,
      });
      const wei = json?.result ? parseInt(json.result, 16) : null;
      const gwei = wei ? wei / 1e9 : null;
      const candidate = buildCandidate(chain, rpcProviderLabel('rpc', rpc), gwei);
      if (candidate) return candidate;
    } catch (e) {
      // next rpc
    }
  }
  return null;
}

async function rpcPriorityPlusBase(chain, timeout) {
  const rpcs = toRpcList(chain.rpc);
  for (const rpc of rpcs) {
    try {
      const [base, tip] = await Promise.all([
        fetchJson(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: ['latest', false] }),
          timeout,
        }),
        fetchJson(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_maxPriorityFeePerGas', params: [] }),
          timeout,
        }),
      ]);
      const baseFee = base?.result?.baseFeePerGas ? parseInt(base.result.baseFeePerGas, 16) : null;
      const tipWei = tip?.result ? parseInt(tip.result, 16) : null;
      const totalWei = baseFee && tipWei ? baseFee + tipWei : baseFee || tipWei;
      const gwei = totalWei ? totalWei / 1e9 : null;
      const candidate = buildCandidate(chain, rpcProviderLabel('rpc-priority', rpc), gwei);
      if (candidate) return candidate;
    } catch (e) {
      // continue
    }
  }
  return null;
}

async function blocknative(chain, timeout) {
  const url = 'https://api.blocknative.com/gasprices/blockprices';
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.BLOCKNATIVE_API_KEY) headers.Authorization = process.env.BLOCKNATIVE_API_KEY;
  const json = await fetchJson(url, { timeout, headers });
  const price = json?.blockPrices?.[0]?.estimatedPrices?.[0]?.price;
  return buildCandidate(chain, 'blocknative', price);
}

async function owlracle(chain, timeout) {
  const network = chain.key === 'eth' ? 'eth' : chain.key;
  const key = process.env.OWLRACLE_KEY ? `&apikey=${process.env.OWLRACLE_KEY}` : '';
  const url = `https://owlracle.info/${network}/gas?accept=application/json${key}`;
  const json = await fetchJson(url, { timeout });
  const price = json?.avgGasPrice || json?.average || json?.speeds?.[1]?.gasPrice;
  return buildCandidate(chain, 'owlracle', price);
}

async function fallbackMedianBaseFee(chain, timeout) {
  const rpc = toRpcList(chain.rpc)[0];
  if (!rpc) return null;
  try {
    const blockNumber = await fetchJson(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'eth_blockNumber', params: [] }),
      timeout,
    });
    const latest = blockNumber?.result ? parseInt(blockNumber.result, 16) : null;
    if (!latest) return null;
    const bases = [];
    for (let i = 0; i < 5; i += 1) {
      const tag = `0x${(latest - i).toString(16)}`;
      const blk = await fetchJson(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 6 + i, method: 'eth_getBlockByNumber', params: [tag, false] }),
        timeout,
      });
      const base = blk?.result?.baseFeePerGas ? parseInt(blk.result.baseFeePerGas, 16) : null;
      if (base) bases.push(base / 1e9);
    }
    const med = median(bases);
    const price = med ? med * 1.2 : null;
    return buildCandidate(chain, 'basefee-fallback', price);
  } catch (e) {
    return null;
  }
}

async function fetchEvmGas(chain) {
  const timeout = 600;
  const providers = [
    () => fromEtherscan(chain, timeout),
    () => rpcGasPrice(chain, timeout),
    () => rpcPriorityPlusBase(chain, timeout),
    () => blocknative(chain, timeout),
    () => owlracle(chain, timeout),
    () => fallbackMedianBaseFee(chain, timeout),
  ];

  const candidate = await tryAll(providers, timeout, 4000).catch(() => null);
  if (candidate) return [candidate];

  // chain-specific fixed fallbacks
  if (chain.key === 'bsc') return [buildCandidate(chain, 'fixed-3-gwei', 3)].filter(Boolean);
  if (chain.key === 'polygon') return [buildCandidate(chain, 'fixed-30-gwei', 30)].filter(Boolean);
  if (chain.key === 'avax') return [buildCandidate(chain, 'fixed-35-gwei', 35)].filter(Boolean);
  return [];
}

module.exports = { fetchEvmGas, validGasPrice };
