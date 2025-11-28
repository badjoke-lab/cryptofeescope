const assert = require('assert');
const { fetchPriceUSD } = require('../lib/fetchPrice/price');
const { createMockFetch, runTest } = require('./helpers');

async function testMedianPrice() {
  const mock = createMockFetch([
    { match: 'coingecko', response: { bitcoin: { usd: 100 } } },
    { match: 'cryptocompare', response: { USD: 300 } },
    { match: 'binance', response: { price: 200 } },
    { match: 'coinbase', response: { data: { amount: '200' } } },
  ]);
  const original = global.fetch;
  global.fetch = mock;
  try {
    const res = await fetchPriceUSD('BTC', { now: new Date('2024-01-01T00:00:00Z') });
    assert.strictEqual(res.priceUSD, 200);
    assert(res.updated.includes('2024-01-01'));
  } finally {
    global.fetch = original;
  }
}

async function testPriceFailureThrows() {
  const mock = createMockFetch([]);
  const original = global.fetch;
  global.fetch = mock;
  let threw = false;
  try {
    await fetchPriceUSD('BTC');
  } catch (e) {
    threw = true;
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(threw, true);
}

async function runPriceTests() {
  await runTest('price median', testMedianPrice);
  await runTest('price failure', testPriceFailureThrows);
}

module.exports = { runPriceTests };

if (require.main === module) {
  runPriceTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
