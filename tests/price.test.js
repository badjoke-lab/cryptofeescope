const assert = require('assert');
const { fetchPriceUSD } = require('../lib/fetchPrice/price');
const { createMockFetch, runTest, jsonResponse } = require('./helpers');

async function testPrimaryPrice() {
  const mock = createMockFetch([
    { match: 'coingecko', response: { bitcoin: { usd: 100 } } },
  ]);
  const original = global.fetch;
  global.fetch = mock;
  try {
    const res = await fetchPriceUSD('BTC', { now: new Date('2024-01-01T00:00:00Z') });
    assert.strictEqual(res.priceUSD, 100);
    assert.strictEqual(res.source, 'coingecko');
    assert.strictEqual(res.status, 'ok');
    assert(res.updated.includes('2024-01-01'));
  } finally {
    global.fetch = original;
  }
}

async function testDeepFallback() {
  const mock = createMockFetch([
    { match: 'coingecko', response: () => { throw new Error('down'); } },
    { match: 'cryptocompare', response: { USD: 0 } },
    { match: 'binance', response: { price: '0' } },
    { match: 'kucoin', response: { data: { price: '0' } } },
    { match: 'kraken', response: { result: { XXBTZUSD: { c: ['0'] } } } },
    { match: 'coinbase', response: jsonResponse({ data: { amount: '0' } }) },
    { match: 'okx', response: { data: [{ last: '250' }] } },
  ]);
  const original = global.fetch;
  global.fetch = mock;
  try {
    const res = await fetchPriceUSD('BTC');
    assert.strictEqual(res.priceUSD, 250);
    assert.strictEqual(res.source, 'okx');
  } finally {
    global.fetch = original;
  }
}

async function testAllFail() {
  const mock = createMockFetch([{ match: () => true, response: () => { throw new Error('fail'); } }]);
  const original = global.fetch;
  global.fetch = mock;
  try {
    const res = await fetchPriceUSD('ETH');
    assert.strictEqual(res.status, 'api-failed');
    assert.strictEqual(res.priceUSD, null);
  } finally {
    global.fetch = original;
  }
}

async function runPriceTests() {
  await runTest('price primary source', testPrimaryPrice);
  await runTest('price deep fallback', testDeepFallback);
  await runTest('price all fail', testAllFail);
}

module.exports = { runPriceTests };

if (require.main === module) {
  runPriceTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
