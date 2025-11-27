const assert = require('assert');
const { validateFee } = require('../lib/validate/validateFee');
const ranges = require('../config/ranges');
const { runTest } = require('./helpers');

function fresh() { return new Date().toISOString(); }

async function testRangeEnforcement() {
  const candidates = [
    { feeNative: 10, updated: fresh(), provider: 'bad' },
    { feeNative: 0.001, updated: fresh(), provider: 'good' },
  ];
  const result = validateFee('polygon', 1, candidates);
  assert(result.feeUSD >= ranges.polygon.minUSD && result.feeUSD <= ranges.polygon.maxUSD);
  assert.strictEqual(result.status, 'ok');
}

async function testMedianFallback() {
  const old = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const candidates = [
    { feeNative: 10, updated: fresh(), provider: 'high' },
    { feeNative: 9, updated: old, provider: 'stale' },
  ];
  const res = validateFee('sol', 1, candidates);
  assert(res.feeUSD <= ranges.sol.maxUSD, 'should clamp to max');
  assert.strictEqual(res.status, 'estimated');
}

async function testRejectZero() {
  const candidates = [
    { feeNative: 0, updated: fresh(), provider: 'zero' },
    { feeNative: 0.00001, updated: fresh(), provider: 'valid' },
  ];
  const res = validateFee('xrp', 1, candidates);
  assert(res.feeNative > 0);
}

async function runFeeTests() {
  await runTest('fee range enforcement', testRangeEnforcement);
  await runTest('fee median fallback', testMedianFallback);
  await runTest('fee rejects zero', testRejectZero);
}

module.exports = { runFeeTests };

if (require.main === module) {
  runFeeTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
