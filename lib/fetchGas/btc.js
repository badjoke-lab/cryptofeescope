const { fetchJson } = require('../utils/http');
const { tryAll, pickValid } = require('../utils/fallback');
const { median } = require('../utils/median');

const MIN_SAT = 1;
const MAX_SAT = 500;

function validSat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_SAT || n > MAX_SAT) return null;
  return n;
}

function buildCandidate(provider, satPerVbyte, vBytes = 140) {
  const sat = validSat(satPerVbyte);
  if (!sat) return null;
  return {
    chain: 'btc',
    provider,
    satPerVbyte: sat,
    vBytes,
    feeNative: (sat * vBytes) / 1e8,
    updated: new Date().toISOString(),
  };
}

async function fromMempool(timeout) {
  const json = await fetchJson('https://mempool.space/api/v1/fees/recommended', { timeout });
  const sat = pickValid([json?.fastestFee, json?.halfHourFee, json?.hourFee]);
  return buildCandidate('mempool', sat);
}

async function fromBlockstream(timeout) {
  const json = await fetchJson('https://blockstream.info/api/fee-estimates', { timeout });
  const values = Object.values(json || {})
    .map(v => validSat(v))
    .filter(Boolean);
  return buildCandidate('blockstream', median(values));
}

async function fromBlockchainInfo(timeout) {
  const json = await fetchJson('https://api.blockchain.info/mempool/fees', { timeout });
  const sat = pickValid([json?.priority, json?.regular, json?.minimumfee]);
  return buildCandidate('blockchain.info', sat);
}

async function fromBtcCom(timeout) {
  const json = await fetchJson('https://chain.api.btc.com/v3/block/latest', { timeout });
  const satPerKb = json?.data?.fee_per_kb || json?.data?.median_fee || null;
  const sat = satPerKb ? satPerKb / 1000 : null;
  return buildCandidate('btc.com', sat);
}

async function fromBitgo(timeout) {
  const json = await fetchJson('https://www.bitgo.com/api/v2/btc/tx/fee', { timeout });
  const sat = json?.feePerKb ? json.feePerKb / 1000 : null;
  return buildCandidate('bitgo', sat);
}

async function fallbackFromRecentBlocks(timeout) {
  const json = await fetchJson('https://mempool.space/api/v1/blocks', { timeout });
  const sats = (json || [])
    .map(b => b?.extras?.avgFeePerByte || b?.extras?.feeRange?.[2])
    .map(validSat)
    .filter(Boolean);
  return buildCandidate('recent-blocks', median(sats) || 50);
}

async function fetchBtcGas() {
  const timeout = 600;
  const providers = [
    () => fromMempool(timeout),
    () => fromBlockstream(timeout),
    () => fromBlockchainInfo(timeout),
    () => fromBtcCom(timeout),
    () => fromBitgo(timeout),
    () => fallbackFromRecentBlocks(timeout),
  ];
  const candidate = await tryAll(providers, timeout, 4000).catch(() => null);
  return candidate ? [candidate] : [];
}

module.exports = { fetchBtcGas };
