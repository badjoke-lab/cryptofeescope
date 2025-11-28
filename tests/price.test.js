const assert = require('assert');
const { fetchPriceUSD } = require('../lib/fetchPrice/price');
const { createMockFetch, runTest } = require('./helpers');

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

async function testFallbackOrder() {
  const mock = createMockFetch([
    { match: 'coingecko', response: () => { throw new Error('down'); } },
    { match: 'cryptocompare', response: { USD: 200 } },
  ]);
  const original = global.fetch;
  global.fetch = mock;
  try {
    const res = await fetchPriceUSD('ETH');
    assert.strictEqual(res.priceUSD, 200);
    assert.strictEqual(res.source, 'cryptocompare');
  } finally {
    global.fetch = original;
  }
}

async function testAllFail() {
  const mock = createMockFetch([]);
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
  await runTest('price fallback order', testFallbackOrder);
  await runTest('price all fail', testAllFail);
}

module.exports = { runPriceTests };

if (require.main === module) {
  runPriceTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
