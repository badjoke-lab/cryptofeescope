const { fetchJson, toNumber } = require('../utils/http');
const { median } = require('../utils/median');

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildCandidate(provider, satPerVbyte) {
  const sat = toNumber(satPerVbyte);
  if (!sat || sat <= 0) return null;
  const vBytes = 140;
  const feeNative = (sat * vBytes) / 1e8;
  return {
    id: uid(),
    chain: 'btc',
    provider,
    satPerVbyte: sat,
    vBytes,
    feeNative,
    updated: new Date().toISOString(),
  };
}

async function fromMempool() {
  const json = await fetchJson('https://mempool.space/api/v1/fees/recommended');
  const sat = json?.fastestFee || json?.halfHourFee || json?.hourFee;
  return buildCandidate('mempool', sat);
}

async function fromBlockstream() {
  const json = await fetchJson('https://blockstream.info/api/fee-estimates');
  const values = Object.values(json || {}).map(v => toNumber(v)).filter(Boolean);
  const sat = median(values);
  return buildCandidate('blockstream', sat);
}

async function fromBlockchair() {
  const json = await fetchJson('https://api.blockchair.com/bitcoin/stats');
  const sat = json?.data?.suggested_transaction_fee_per_byte_sat || json?.data?.mempool?.median_fee_per_byte_sat;
  return buildCandidate('blockchair', sat);
}

async function fromBlockCypher() {
  const json = await fetchJson('https://api.blockcypher.com/v1/btc/main');
  const satPerKb = json?.high_fee_per_kb || json?.medium_fee_per_kb;
  const sat = satPerKb ? satPerKb / 1000 : null;
  return buildCandidate('blockcypher', sat);
}

async function fetchBtcGas() {
  const providers = [fromMempool, fromBlockstream, fromBlockchair, fromBlockCypher];
  const results = [];
  for (const fn of providers) {
    try {
      const cand = await fn();
      if (cand) results.push(cand);
    } catch (e) {
      // ignore provider failure
    }
  }
  return results;
}

module.exports = { fetchBtcGas };
