/*
 * Fee / Speed consistency suite
 */

const { getAllFeeCandidates, getAllSpeedCandidates, median, deviation } = require('./test-helpers');

const CHAINS = ['btc', 'eth', 'bsc', 'sol', 'polygon', 'avax', 'xrp', 'arb', 'op', 'base'];

function summarize(name, candidates) {
  const numeric = candidates.filter(c => c && c.ok && Number.isFinite(c.value)).map(c => Number(c.value));
  const med = median(numeric);
  const dev = deviation(numeric, med);
  const failRate = candidates.length === 0 ? 1 : 1 - numeric.length / candidates.length;
  return { chain: name, median: med, deviation: dev, failRate, total: candidates.length, successes: numeric.length };
}

async function main() {
  console.log('Running fee/speed consistency test...');
  const feeAll = await getAllFeeCandidates(CHAINS);
  const speedAll = await getAllSpeedCandidates(CHAINS);

  for (const chain of CHAINS) {
    const feeStats = summarize(chain, feeAll[chain] || []);
    const speedStats = summarize(chain, speedAll[chain] || []);

    console.log(`\nChain: ${chain}`);
    console.log('  Fee candidates:', feeAll[chain]?.length || 0);
    feeAll[chain]?.forEach(c => {
      console.log(`   - [${c.provider}/${c.type}] => ${c.value === null ? 'null' : c.value}${c.ok ? '' : ' (fail)'}`);
    });
    console.log('  Speed candidates:', speedAll[chain]?.length || 0);
    speedAll[chain]?.forEach(c => {
      console.log(`   - [${c.provider}/${c.type}] => ${c.value === null ? 'null' : c.value}${c.ok ? '' : ' (fail)'}`);
    });

    console.log('  Fee stats:', feeStats);
    console.log('  Speed stats:', speedStats);
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
