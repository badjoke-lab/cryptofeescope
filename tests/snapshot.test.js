const assert = require('assert');
const { generateSnapshot } = require('../api/snapshot');
const ranges = require('../config/ranges');
const { createMockFetch, runTest, assertRange } = require('./helpers');

const PRICE_MAP = {
  bitcoin: 50000,
  ethereum: 3000,
  binancecoin: 300,
  polygon: 1,
  'avalanche-2': 40,
  solana: 20,
  ripple: 0.6,
};

function priceFromUrl(url) {
  const id = Object.keys(PRICE_MAP).find(key => url.includes(key));
  return PRICE_MAP[id] || 1;
}

const mockFetch = createMockFetch([
  { match: 'coingecko', response: url => ({ [Object.keys(PRICE_MAP).find(k => url.includes(k))]: { usd: priceFromUrl(url) } }) },
  { match: 'cryptocompare', response: url => ({ USD: priceFromUrl(url) * 1.02 }) },
  { match: 'binance', response: url => ({ price: priceFromUrl(url) * 0.98 }) },
  { match: 'mempool.space', response: { fastestFee: 100, halfHourFee: 90 } },
  { match: 'blockstream', response: { 1: 110, 2: 100 } },
  { match: 'blockchair', response: { data: { suggested_transaction_fee_per_byte_sat: 120 } } },
  { match: 'etherscan.io', response: { result: { ProposeGasPrice: '30', SafeGasPrice: '30' } } },
  { match: 'bscscan.com', response: { result: { ProposeGasPrice: '8', SafeGasPrice: '8' } } },
  { match: 'polygonscan.com', response: { result: { ProposeGasPrice: '35', SafeGasPrice: '35' } } },
  { match: 'snowtrace.io', response: { result: { ProposeGasPrice: '20', SafeGasPrice: '20' } } },
  { match: 'arb1.arbitrum.io', response: { result: '0x2540be400' } },
  { match: 'mainnet.optimism.io', response: { result: '0x2540be400' } },
  { match: 'mainnet.base.org', response: { result: '0x2540be400' } },
  { match: 'rpc.ankr.com/eth', response: { result: '0x6fc23ac00' } },
  { match: 'bsc-dataseed', response: { result: '0x1dcd65000' } },
  { match: 'polygon-rpc.com', response: { result: '0x82dace9c0' } },
  { match: 'api.avax.network', response: { result: '0x4a817c800' } },
  { match: 'mainnet-beta.solana.com', response: { result: { value: { feeCalculator: { lamportsPerSignature: 5000 } } } } },
  { match: 'ripple.com', response: { result: { drops: { open_ledger: '12' } } } },
]);

async function testSnapshotShape() {
  const original = global.fetch;
  global.fetch = mockFetch;
  try {
    const snap = await generateSnapshot();
    const chains = Object.keys(ranges);
    chains.forEach(key => {
      const entry = snap.chains[key];
      assert(entry, `missing chain ${key}`);
      assert(entry.updated, 'missing timestamp');
      assert(entry.status === 'ok' || entry.status === 'estimated');
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
