/*
 * Fee / Speed consistency suite
 */

const { getAllFeeCandidates, getAllSpeedCandidates, median, deviation, mad } = require('./test-helpers');

const CHAINS = ['btc', 'eth', 'bsc', 'sol', 'polygon', 'avax', 'xrp', 'arb', 'op', 'base'];

function summarize(name, candidates) {
  const numeric = candidates.filter(c => c && c.ok && Number.isFinite(c.value)).map(c => Number(c.value));
  const med = median(numeric);
  const dev = mad(numeric, med);
  const failRate = candidates.length === 0 ? 1 : 1 - numeric.length / candidates.length;
  return { chain: name, median: med, deviation: dev, failRate, total: candidates.length, successes: numeric.length };
}

function detectOutliers(candidates, medianValue) {
  const outliers = [];
  for (const c of candidates) {
    if (!c || !c.ok || !Number.isFinite(c.value) || !Number.isFinite(medianValue) || medianValue === 0) continue;
    const pct = Math.abs(c.value - medianValue) / Math.abs(medianValue);
    if (pct > 0.6) {
      outliers.push({ level: 'hard', pct, candidate: c });
    } else if (pct > 0.25) {
      outliers.push({ level: 'warn', pct, candidate: c });
    }
  }
  return outliers.sort((a, b) => b.pct - a.pct);
}

async function main() {
  console.log('Running fee/speed consistency test...');
  const feeAll = await getAllFeeCandidates(CHAINS);
  const speedAll = await getAllSpeedCandidates(CHAINS);

  const summaryRows = [];
  for (const chain of CHAINS) {
    const feeCandidates = feeAll[chain] || [];
    const speedCandidates = speedAll[chain] || [];
    const feeStats = summarize(chain, feeCandidates);
    const speedStats = summarize(chain, speedCandidates);
    const feeOutliers = detectOutliers(feeCandidates, feeStats.median).slice(0, 3);
    const speedOutliers = detectOutliers(speedCandidates, speedStats.median).slice(0, 3);

    console.log(`\nChain: ${chain}`);
    console.log('  Fee candidates:', feeCandidates.length);
    feeCandidates.forEach(c => {
      const label = `[${c.provider}/${c.type}]`;
      const val = c.value === null || c.value === undefined ? 'null' : c.value;
      const status = c.ok ? '' : ` (fail${c.error ? ': ' + c.error : ''})`;
      console.log(`   - ${label} ${val}${status}`);
    });
    console.log('  Speed candidates:', speedCandidates.length);
    speedCandidates.forEach(c => {
      const label = `[${c.provider}/${c.type}]`;
      const val = c.value === null || c.value === undefined ? 'null' : c.value;
      const status = c.ok ? '' : ` (fail${c.error ? ': ' + c.error : ''})`;
      console.log(`   - ${label} ${val}${status}`);
    });

    console.log('  Fee stats:', feeStats, 'outliers:', feeOutliers.map(o => ({ key: `${o.candidate.provider}/${o.candidate.type}`, pct: o.pct })));
    console.log('  Speed stats:', speedStats, 'outliers:', speedOutliers.map(o => ({ key: `${o.candidate.provider}/${o.candidate.type}`, pct: o.pct })));

    summaryRows.push({
      chain,
      feeMedian: feeStats.median,
      feeFailRate: feeStats.failRate,
      speedMedian: speedStats.median,
      speedFailRate: speedStats.failRate,
      feeOutliers,
      speedOutliers,
    });
  }

  console.log('\nSummary table');
  console.log('chain | medianFeeUSD | feeFailRate | medianSpeedSec | speedFailRate | topFeeOutliers | topSpeedOutliers');
  summaryRows.forEach(row => {
    const feeOut = row.feeOutliers.map(o => `${o.candidate.provider}/${o.candidate.type}`).join(', ');
    const speedOut = row.speedOutliers.map(o => `${o.candidate.provider}/${o.candidate.type}`).join(', ');
    console.log(
      `${row.chain} | ${row.feeMedian ?? 'n/a'} | ${row.feeFailRate.toFixed(2)} | ${row.speedMedian ?? 'n/a'} | ${row.speedFailRate.toFixed(2)} | ${feeOut || 'none'} | ${speedOut || 'none'}`
    );
  });

  console.log('\nCompleted fee/speed consistency run.');
}

if (process.env.CFS_TEST) {
  main().catch(err => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
}

module.exports = { CHAINS, main };
