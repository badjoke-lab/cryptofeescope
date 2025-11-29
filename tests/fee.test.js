const assert = require('assert');
const { validateFee } = require('../lib/validate/validateFee');
const ranges = require('../config/ranges');
const { runTest } = require('./helpers');

function fresh() { return new Date().toISOString(); }

async function testValidCandidateAccepted() {
  const candidates = [{ feeNative: 0.002, provider: 'ok', updated: fresh() }];
  const res = validateFee('eth', 2000, candidates);
  assert.strictEqual(res.status, 'ok');
  assert(res.feeUSD > ranges.eth.minUSD && res.feeUSD < ranges.eth.maxUSD);
}

async function testOutOfRangeRejected() {
  const candidates = [{ feeNative: 10, provider: 'bad', updated: fresh() }];
  const res = validateFee('bsc', 100, candidates);
  assert.strictEqual(res.status, 'api-failed');
  assert.strictEqual(res.feeUSD, null);
}

async function testStaleCandidateFails() {
  const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const candidates = [{ feeNative: 0.1, updated: old, provider: 'old' }];
  const res = validateFee('sol', 10, candidates);
  assert.strictEqual(res.status, 'api-failed');
}

async function runFeeTests() {
  await runTest('fee accepts valid candidate', testValidCandidateAccepted);
  await runTest('fee rejects out of range', testOutOfRangeRejected);
  await runTest('fee stale candidate', testStaleCandidateFails);
}

module.exports = { runFeeTests };

if (require.main === module) {
  runFeeTests().then(() => {
    if (process.exitCode) process.exit(process.exitCode);
  });
}
