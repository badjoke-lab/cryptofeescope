const assert = require('assert');
const { generateSnapshot } = require('../api/snapshot');
const ranges = require('../config/ranges');
const { runTest, assertRange, jsonResponse } = require('./helpers');

const PRICE_MAP = {
  bitcoin: 40000,
  ethereum: 2000,
  binancecoin: 300,
  polygon: 1,
  'avalanche-2': 30,
  solana: 20,
  ripple: 0.6,
  arbitrum: 1.2,
  optimism: 1.5,
  'base-pro': 5,
};

function mockFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (url.includes('coingecko')) {
    const match = /ids=([^&]+)/.exec(url);
    const id = match ? decodeURIComponent(match[1]) : 'bitcoin';
    return jsonResponse({ [id]: { usd: PRICE_MAP[id] || 1 } });
  }
  if (url.includes('mempool.space/api/v1/fees/recommended')) {
    return jsonResponse({ fastestFee: 20, halfHourFee: 15, hourFee: 10 });
  }
  if (url.includes('etherscan.io')) {
    return jsonResponse({ result: { FastGasPrice: '30', ProposeGasPrice: '30', SafeGasPrice: '28' } });
  }
  if (url.includes('bscscan.com')) {
    return jsonResponse({ result: { FastGasPrice: '5', ProposeGasPrice: '5', SafeGasPrice: '5' } });
  }
  if (url.includes('polygonscan.com')) {
    return jsonResponse({ result: { FastGasPrice: '50', ProposeGasPrice: '50', SafeGasPrice: '50' } });
  }
  if (url.includes('snowtrace.io')) {
    return jsonResponse({ result: { FastGasPrice: '35', ProposeGasPrice: '35', SafeGasPrice: '35' } });
  }
  if (method === 'POST' && url.includes('solana')) {
    return jsonResponse({ result: { value: { feeCalculator: { lamportsPerSignature: 5000 } } } });
  }
  if (method === 'POST' && url.includes('ripple.com')) {
    const body = JSON.parse(options.body || '{}');
    if (body.method === 'server_info') {
      return jsonResponse({ result: { info: { validated_ledger: { base_fee_xrp: 0.0009 } } } });
    }
    if (body.method === 'fee') {
      return jsonResponse({ result: { drops: { open_ledger: '900', median_fee: '900' } } });
    }
  }
  if (method === 'POST' && url.includes('rollup_gasPrices')) {
    return jsonResponse({
      result: {
        l1GasPrice: '0x37e11d600',
        l2GasPrice: '0x1dcd6500',
        l1DataFee: '0x19945ca262000',
      },
    });
  }
  if (method === 'POST' && url.includes('arb1.arbitrum.io')) {
    const body = JSON.parse(options.body || '{}');
    if (body.method === 'rollup_gasPrices') {
      return mockFetch('rollup_gasPrices', options);
    }
  }
  if (method === 'POST' && (url.includes('optimism') || url.includes('base')) && options.body) {
    const body = JSON.parse(options.body);
    if (body.method === 'rollup_gasPrices') {
      return mockFetch('rollup_gasPrices', options);
    }
  }
  if (method === 'POST' && url.includes('rpc.ankr.com/eth')) {
    const body = JSON.parse(options.body || '{}');
    if (body.method === 'eth_getBlockByNumber') {
      return jsonResponse({ result: { baseFeePerGas: '0x59682f00' } });
    }
  }
  if (method === 'POST' && /rpc|publicnode|dataseed|avax|polygon/.test(url)) {
    const body = JSON.parse(options.body || '{}');
    if (body.method === 'eth_gasPrice') {
      return jsonResponse({ result: '0x1dcd6500' });
    }
    if (body.method === 'eth_blockNumber') {
      return jsonResponse({ result: '0x10' });
    }
    if (body.method === 'eth_getBlockByNumber') {
      return jsonResponse({ result: { baseFeePerGas: '0x59682f00' } });
    }
  }
  if (url.includes('www.bitgo.com')) {
    return jsonResponse({ feePerKb: 20000 });
  }
  if (url.includes('blockstream.info')) {
    return jsonResponse({ 1: 25, 2: 22, 3: 20 });
  }
  if (url.includes('api.blockchain.info')) {
    return jsonResponse({ regular: 18, priority: 20 });
  }
  if (url.includes('chain.api.btc.com')) {
    return jsonResponse({ data: { fee_per_kb: 20000 } });
  }
  if (url.includes('mempool.space/api/v1/blocks')) {
    return jsonResponse([{ extras: { avgFeePerByte: 22 } }]);
  }
  throw new Error(`Unmocked fetch ${url}`);
}

async function testSnapshotShape() {
  const original = global.fetch;
  global.fetch = mockFetch;
  try {
    const start = Date.now();
    const snap = await generateSnapshot();
    const duration = Date.now() - start;
    assert(duration < 2000, 'snapshot took too long');
    const chainsKeys = Object.keys(ranges);
    chainsKeys.forEach(key => {
      const entry = snap.chains[key];
      assert(entry, `missing chain ${key}`);
      assert.strictEqual(entry.status, 'ok');
      assertRange(entry.feeUSD, ranges[key].minUSD, ranges[key].maxUSD, `${key} feeUSD`);
      assert(entry.priceUSD != null, 'price missing');
      assert(Number.isFinite(entry.feeNative), 'feeNative missing');
    });
  } finally {
    global.fetch = original;
  }
}

async function runSnapshotTests() {
  await runTest('snapshot shape', testSnapshotShape);
}

module.exports = { runSnapshotTests };

if (require.main === module) {
  runSnapshotTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
