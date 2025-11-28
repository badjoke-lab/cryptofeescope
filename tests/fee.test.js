const assert = require('assert');
const { validateFee } = require('../lib/validate/validateFee');
const ranges = require('../config/ranges');
const { runTest } = require('./helpers');

function fresh() { return new Date().toISOString(); }

async function testRangeEnforcement() {
  const candidates = [
    { feeNative: 0.0005, updated: fresh(), provider: 'good' },
  ];
  const result = validateFee('polygon', 1, candidates);
  assert(result.feeUSD >= ranges.polygon.minUSD && result.feeUSD <= ranges.polygon.maxUSD);
  assert.strictEqual(result.status, 'ok');
}

async function testRejectsInvalidPrice() {
  const candidates = [{ feeNative: 0.1, updated: fresh(), provider: 'any' }];
  const result = validateFee('eth', null, candidates);
  assert.strictEqual(result.status, 'api-failed');
  assert.strictEqual(result.feeUSD, null);
}

async function testStaleCandidateFails() {
  const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const candidates = [{ feeNative: 0.1, updated: old, provider: 'old' }];
  const res = validateFee('sol', 10, candidates);
  assert.strictEqual(res.status, 'api-failed');
}

async function runFeeTests() {
  await runTest('fee range enforcement', testRangeEnforcement);
  await runTest('fee rejects invalid price', testRejectsInvalidPrice);
  await runTest('fee stale candidate', testStaleCandidateFails);
}

module.exports = { runFeeTests };

if (require.main === module) {
  runFeeTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
