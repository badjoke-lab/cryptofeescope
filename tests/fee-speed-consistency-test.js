/*
 * Fee / Speed consistency suite (correctness-first)
 */

const { getAllFeeCandidates, getAllSpeedCandidates, median, deviation, mad } = require('./test-helpers');

const CHAINS = ['btc', 'eth', 'bsc', 'sol', 'polygon', 'avax', 'xrp', 'arb', 'op', 'base'];

function splitValidity(candidates) {
  const valid = [];
  const invalid = [];
  for (const c of candidates) {
    if (c && c.ok) valid.push(c);
    else invalid.push(c);
  }
  return { valid, invalid };
}

function summarizeValues(list) {
  const nums = list.map(c => Number(c.valueUSD ?? c.valueNative)).filter(v => Number.isFinite(v));
  const med = median(nums);
  return { median: med, dev: mad(nums, med), total: list.length };
}

function healthVerdict(stats) {
  if (stats.validCount >= 2 && (stats.dev == null || stats.dev < (stats.median || 1) * 0.8)) return 'PASS';
  if (stats.validCount === 1 || (stats.dev != null && stats.dev > (stats.median || 1) * 1.5)) return 'WARN';
  return 'FAIL';
}

function printCandidates(label, list) {
  console.log(`  ${label} candidates (${list.length})`);
  list.forEach(c => {
    const val = c.valueUSD ?? c.valueNative;
    const displayVal = val == null ? 'null' : val;
    const reason = c.reasonIfInvalid ? ` reason=${c.reasonIfInvalid}` : '';
    console.log(`   - [${c.provider}/${c.type || c.key}] ${displayVal}${c.ok ? '' : ' (invalid)'}${reason}`);
  });
}

async function main() {
  console.log('Running fee/speed consistency test...');
  const feeAll = await getAllFeeCandidates(CHAINS);
  const speedAll = await getAllSpeedCandidates(CHAINS);

  for (const chain of CHAINS) {
    const feeCandidates = feeAll[chain] || [];
    const speedCandidates = speedAll[chain] || [];
    const { valid: feeValid, invalid: feeInvalid } = splitValidity(feeCandidates);
    const { valid: speedValid, invalid: speedInvalid } = splitValidity(speedCandidates);

    const feeStats = summarizeValues(feeValid);
    const speedStats = summarizeValues(speedValid);
    const verdict = healthVerdict({
      validCount: feeValid.length,
      median: feeStats.median,
      dev: feeStats.dev,
    });

    console.log(`\nChain: ${chain} [${verdict}]`);
    printCandidates('Fee valid', feeValid);
    printCandidates('Fee invalid', feeInvalid);
    printCandidates('Speed valid', speedValid);
    printCandidates('Speed invalid', speedInvalid);
    console.log(`  Fee median=${feeStats.median} mad=${feeStats.dev} failRate=${feeCandidates.length === 0 ? 1 : 1 - feeValid.length / feeCandidates.length}`);
    console.log(`  Speed median=${speedStats.median} mad=${speedStats.dev} failRate=${speedCandidates.length === 0 ? 1 : 1 - speedValid.length / speedCandidates.length}`);
  }

  console.log('\nCompleted fee/speed consistency run.');
}

if (process.env.CFS_TEST) {
  main().catch(err => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
}

module.exports = { CHAINS, main };
