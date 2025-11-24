// api/snapshot.js
// Fee + speed calculation rebuild (correctness-first)

const fetchImpl = global.fetch || require('node-fetch');

const COINGECKO_IDS = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  arb: 'arbitrum',
  op: 'optimism',
  base: 'base',
  polygon: 'polygon',
  bsc: 'binancecoin',
  avax: 'avalanche-2',
  xrp: 'ripple',
};

const RPC_ENDPOINTS = {
  eth: 'https://rpc.ankr.com/eth',
  bsc: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon-rpc.com',
  avax: 'https://api.avax.network/ext/bc/C/rpc',
  arb: 'https://arb1.arbitrum.io/rpc',
  op: 'https://mainnet.optimism.io',
  base: 'https://mainnet.base.org',
};

const PRICE_TTL_MS = 12 * 60 * 1000;
let LAST_PRICE = null;
let LAST_PRICE_AT = 0;
const PRICE_FALLBACK_CACHE = {};

const DEFAULT_USD_TO_JPY = 150;

function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...options, signal: controller.signal })
    .then(async res => {
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return res.json();
    })
    .catch(err => {
      clearTimeout(timer);
      throw err;
    });
}

function normalizeNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function markInvalid(candidate, reason) {
  return { ...candidate, ok: false, reasonIfInvalid: reason };
}

function applyValidation(candidates) {
  const list = candidates.map(c => {
    const val = normalizeNumber(c.valueNative);
    const valUsd = normalizeNumber(c.valueUSD);
    if (val === null || val < 0) return markInvalid(c, 'missing_or_negative');
    if (val === 0) return markInvalid(c, 'zero');
    return { ...c, valueNative: val, valueUSD: valUsd, ok: c.ok !== false };
  });

  const hasPositive = list.some(c => c.ok && c.valueNative > 0);
  if (hasPositive) {
    return list.map(c => {
      if (c.valueNative === 0) return markInvalid(c, 'zero_vs_positive');
      return c;
    });
  }
  return list;
}

function choosePrimary(candidates) {
  const valids = candidates.filter(c => c.ok && c.valueNative > 0);
  if (!valids.length) return null;
  const withUsd = valids.filter(c => Number.isFinite(c.valueUSD));
  const list = withUsd.length ? withUsd : valids;
  const sorted = [...list].sort((a, b) => (a.valueUSD ?? a.valueNative) - (b.valueUSD ?? b.valueNative));
  return sorted[Math.floor(sorted.length / 2)];
}

async function getPrices() {
  const now = Date.now();
  if (LAST_PRICE && now - LAST_PRICE_AT < PRICE_TTL_MS) return LAST_PRICE;

  const ids = Object.values(COINGECKO_IDS).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,jpy`;
  try {
    const data = await fetchJson(url);
    LAST_PRICE = Object.entries(COINGECKO_IDS).reduce((acc, [k, id]) => {
      acc[k] = data[id] || {};
      return acc;
    }, {});
    LAST_PRICE_AT = now;
    return LAST_PRICE;
  } catch (e) {
    console.error('[price] coingecko failed', e.message);
    const fallback = await getFallbackPrices();
    LAST_PRICE = fallback;
    LAST_PRICE_AT = now;
    return LAST_PRICE;
  }
}

async function getFallbackPrices() {
  const entries = await Promise.all(
    Object.entries(COINGECKO_IDS).map(async ([k, id]) => {
      const cached = PRICE_FALLBACK_CACHE[k];
      if (cached && Date.now() - cached.at < PRICE_TTL_MS) return [k, cached.data];
      try {
        const resp = await fetchJson(
          `https://min-api.cryptocompare.com/data/price?fsym=${k.toUpperCase()}&tsyms=USD`
        );
        const usd = normalizeNumber(resp?.USD);
        const data = usd ? { usd } : {};
        PRICE_FALLBACK_CACHE[k] = { data, at: Date.now() };
        return [k, data];
      } catch (e) {
        PRICE_FALLBACK_CACHE[k] = { data: {}, at: Date.now() };
        return [k, {}];
      }
    })
  );
  return Object.fromEntries(entries);
}

function usdToJpy(priceObj) {
  const usd = normalizeNumber(priceObj?.usd);
  const jpy = normalizeNumber(priceObj?.jpy);
  if (usd && jpy) return jpy / usd;
  return DEFAULT_USD_TO_JPY;
}

async function fetchRpc(chain, method, params = []) {
  const url = RPC_ENDPOINTS[chain];
  if (!url) throw new Error(`No RPC endpoint for ${chain}`);
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (res?.error) throw new Error(res.error.message || 'rpc error');
  return res.result;
}

function hexToNumber(hex) {
  if (typeof hex !== 'string') return null;
  return parseInt(hex, 16);
}

// ----- Raw metric fetchers -----
async function fetchBtcRaw() {
  const rec = await fetchJson('https://mempool.space/api/v1/fees/recommended');
  return {
    halfHour: normalizeNumber(rec?.halfHourFee),
    hour: normalizeNumber(rec?.hourFee),
    fastest: normalizeNumber(rec?.fastestFee),
    minimum: normalizeNumber(rec?.minimumFee),
  };
}

async function fetchEvmRaw(chain) {
  const gasPriceHex = await fetchRpc(chain, 'eth_gasPrice', []);
  const gasPriceWei = hexToNumber(gasPriceHex);
  let baseFee = null;
  let priorityFee = null;
  try {
    const feeHistory = await fetchRpc(chain, 'eth_feeHistory', [1, 'latest', [50]]);
    const base = Array.isArray(feeHistory?.baseFeePerGas)
      ? feeHistory.baseFeePerGas[0]
      : null;
    baseFee = base ? hexToNumber(base) : null;
    const rewards = Array.isArray(feeHistory?.reward) ? feeHistory.reward[0] : null;
    priorityFee = Array.isArray(rewards) ? hexToNumber(rewards[0]) : null;
  } catch (e) {
    // ignore
  }
  return { gasPriceWei, baseFeeWei: baseFee, priorityFeeWei: priorityFee };
}

async function fetchL1GasForL2() {
  const gasPriceHex = await fetchRpc('eth', 'eth_gasPrice', []);
  return hexToNumber(gasPriceHex);
}

async function fetchSolRaw() {
  const endpoint = 'https://api.mainnet-beta.solana.com';
  const res = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRecentPrioritizationFees', params: [["11111111111111111111111111111111"]] }),
  });
  const fee = Array.isArray(res?.result) && res.result.length ? normalizeNumber(res.result[0].prioritizationFee) : null;
  const base = 5000;
  return { lamports: fee ? fee + base : base };
}

async function fetchXrpRaw() {
  const endpoint = 'https://s1.ripple.com:51234/';
  const res = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'fee', params: [{}] }),
  });
  return { drops: normalizeNumber(res?.result?.drops?.minimum_fee) };
}

// ----- Fee models -----
function btcCandidates(raw, price) {
  const priceUsd = normalizeNumber(price?.usd);
  const candidates = [];
  const rates = [
    { label: 'halfHour', value: raw.halfHour },
    { label: 'hour', value: raw.hour },
    { label: 'fastest', value: raw.fastest },
    { label: 'minimum', value: raw.minimum },
  ];
  const vbList = [140, 225, 250, 400];
  for (const r of rates) {
    for (const vb of vbList) {
      const feeBtc = r.value != null ? (r.value * vb) / 1e8 : null;
      const usd = priceUsd && feeBtc != null ? feeBtc * priceUsd : null;
      candidates.push({
        key: `btc:${r.label}:${vb}`,
        provider: 'mempool.space',
        type: r.label,
        unit: 'BTC',
        valueNative: feeBtc,
        valueUSD: usd,
        priceUnavailable: !priceUsd,
      });
    }
  }
  return applyValidation(candidates);
}

function evmCandidates(chain, raw, price, l1GasPriceWei) {
  const priceUsd = normalizeNumber(price?.usd);
  const gasPriceGwei = raw.gasPriceWei ? raw.gasPriceWei / 1e9 : null;
  const baseFeeGwei = raw.baseFeeWei ? raw.baseFeeWei / 1e9 : null;
  const priorityGwei = raw.priorityFeeWei ? raw.priorityFeeWei / 1e9 : null;
  const limits = [
    { label: 'transfer', value: 21000 },
    { label: 'erc20', value: 65000 },
  ];
  const candidates = [];
  for (const gl of limits) {
    const legacyNative = gasPriceGwei != null ? (gasPriceGwei * gl.value) / 1e9 : null;
    const legacyUsd = priceUsd && legacyNative != null ? legacyNative * priceUsd : null;
    candidates.push({
      key: `${chain}:legacy:${gl.label}`,
      provider: 'rpc',
      type: 'legacy',
      unit: 'native',
      valueNative: legacyNative,
      valueUSD: legacyUsd,
      priceUnavailable: !priceUsd,
    });

    if (baseFeeGwei != null && priorityGwei != null) {
      const feeNative = ((baseFeeGwei + priorityGwei) * gl.value) / 1e9;
      const usd = priceUsd && feeNative != null ? feeNative * priceUsd : null;
      candidates.push({
        key: `${chain}:1559:${gl.label}`,
        provider: 'rpc',
        type: '1559',
        unit: 'native',
        valueNative: feeNative,
        valueUSD: usd,
        priceUnavailable: !priceUsd,
      });
    }
  }

  if (['arb', 'op', 'base'].includes(chain)) {
    const l1Gwei = l1GasPriceWei ? l1GasPriceWei / 1e9 : null;
    const l1DataGas = chain === 'arb' ? 16000 : 20000;
    if (l1Gwei != null) {
      const l1Native = (l1Gwei * l1DataGas) / 1e9;
      const l1Usd = priceUsd && l1Native != null ? l1Native * priceUsd : null;
      const l2Native = gasPriceGwei != null ? (gasPriceGwei * 21000) / 1e9 : null;
      const l2Usd = priceUsd && l2Native != null ? l2Native * priceUsd : null;
      candidates.push({
        key: `${chain}:withL1`,
        provider: 'synthetic',
        type: 'l2+data',
        unit: 'native',
        valueNative: l1Native != null && l2Native != null ? l1Native + l2Native : null,
        valueUSD: l1Usd != null && l2Usd != null ? l1Usd + l2Usd : null,
        priceUnavailable: !priceUsd,
      });
      candidates.push({
        key: `${chain}:nol1`,
        provider: 'synthetic',
        type: 'l2-only',
        unit: 'native',
        valueNative: l2Native,
        valueUSD: l2Usd,
        priceUnavailable: !priceUsd,
      });
    }
  }

  return applyValidation(candidates);
}

function solCandidates(raw, price) {
  const priceUsd = normalizeNumber(price?.usd);
  const sol = raw.lamports != null ? raw.lamports / 1e9 : null;
  const usd = priceUsd && sol != null ? sol * priceUsd : null;
  const c = [
    {
      key: 'sol:lamports',
      provider: 'rpc',
      type: 'prioritization',
      unit: 'SOL',
      valueNative: sol,
      valueUSD: usd,
      priceUnavailable: !priceUsd,
    },
  ];
  return applyValidation(c);
}

function xrpCandidates(raw, price) {
  const priceUsd = normalizeNumber(price?.usd);
  const drops = raw.drops;
  const xrp = drops != null ? drops / 1e6 : null;
  const usd = priceUsd && xrp != null ? xrp * priceUsd : null;
  const c = [
    {
      key: 'xrp:drops',
      provider: 'rippled',
      type: 'base',
      unit: 'XRP',
      valueNative: xrp,
      valueUSD: usd,
      priceUnavailable: !priceUsd,
    },
  ];
  return applyValidation(c);
}

// ----- Speed candidates -----
async function evmSpeed(chain) {
  const candidates = [];
  const latestHex = await fetchRpc(chain, 'eth_blockNumber', []);
  const latest = hexToNumber(latestHex);
  const b1 = await fetchRpc(chain, 'eth_getBlockByNumber', [`0x${latest.toString(16)}`, false]);
  const b0 = await fetchRpc(chain, 'eth_getBlockByNumber', [`0x${(latest - 1).toString(16)}`, false]);
  const t1 = hexToNumber(b1?.timestamp);
  const t0 = hexToNumber(b0?.timestamp);
  candidates.push({ key: `${chain}:blocktime`, provider: 'rpc', value: t1 && t0 ? t1 - t0 : null });
  return candidates.map(c => ({ ...c, ok: Number.isFinite(c.value) && c.value > 0, reasonIfInvalid: c.value ? null : 'invalid' }));
}

async function btcSpeed() {
  const rec = await fetchJson('https://mempool.space/api/v1/fees/recommended');
  const val = normalizeNumber(rec?.halfHourFee) ? 1800 : null;
  return [{ key: 'btc:median', provider: 'mempool', value: val, ok: val != null }];
}

async function solSpeed() {
  const endpoint = 'https://api.mainnet-beta.solana.com';
  const res = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getRecentPerformanceSamples', params: [5] }),
  });
  const sample = Array.isArray(res?.result) && res.result.length ? res.result[0] : null;
  const val = sample?.numSlots ? sample.samplePeriodSecs / sample.numSlots : null;
  return [{ key: 'sol:perf', provider: 'rpc', value: val, ok: Number.isFinite(val) }];
}

async function xrpSpeed() {
  const val = 4;
  return [{ key: 'xrp:ledger', provider: 'heuristic', value: val, ok: true }];
}

function speedStats(candidates) {
  const valids = candidates.filter(c => c.ok && Number.isFinite(c.value));
  if (!valids.length) return null;
  const sorted = valids.map(c => c.value).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function buildTiers(primaryFeeUsd, speedSec, usdToJpyRate) {
  if (!Number.isFinite(primaryFeeUsd)) return [
    { label: 'standard', feeUSD: null, feeJPY: null, speedSec: speedSec || null },
    { label: 'fast', feeUSD: null, feeJPY: null, speedSec: speedSec ? Math.max(5, Math.round(speedSec * 0.5)) : null },
    { label: 'slow', feeUSD: null, feeJPY: null, speedSec: speedSec ? Math.round(speedSec * 2) : null },
  ];
  const rate = Number.isFinite(usdToJpyRate) ? usdToJpyRate : DEFAULT_USD_TO_JPY;
  return [
    { label: 'standard', feeUSD: primaryFeeUsd, feeJPY: primaryFeeUsd * rate, speedSec: speedSec || null },
    { label: 'fast', feeUSD: primaryFeeUsd * 1.2, feeJPY: primaryFeeUsd * 1.2 * rate, speedSec: speedSec ? Math.max(5, Math.round(speedSec * 0.5)) : null },
    { label: 'slow', feeUSD: primaryFeeUsd * 0.8, feeJPY: primaryFeeUsd * 0.8 * rate, speedSec: speedSec ? Math.round(speedSec * 2) : null },
  ];
}

function chainPayload(chainId, primary, priceObj, speedSec) {
  const usd = primary && Number.isFinite(primary.valueUSD) ? primary.valueUSD : null;
  const jpyRate = usdToJpy(priceObj);
  const feeJPY = usd != null ? usd * jpyRate : null;
  const status = speedSec == null ? 'avg' : speedSec < 60 ? 'fast' : speedSec > 600 ? 'slow' : 'avg';
  return {
    feeUSD: usd,
    feeJPY,
    speedSec: speedSec ?? null,
    status: primary ? status : 'failed',
    updated: new Date().toISOString(),
    tiers: buildTiers(usd, speedSec, jpyRate),
    ok: !!primary,
    priceUnavailable: primary ? primary.priceUnavailable : true,
    nativeFee: primary ? primary.valueNative : null,
    unit: primary ? primary.unit : null,
  };
}

async function buildChain(chainId, prices, l1GasPriceWei) {
  const price = prices?.[chainId] || {};
  if (chainId === 'btc') {
    const raw = await fetchBtcRaw();
    const cands = btcCandidates(raw, price);
    return { primary: choosePrimary(cands), candidates: cands };
  }
  if (['eth', 'bsc', 'polygon', 'avax', 'arb', 'op', 'base'].includes(chainId)) {
    const raw = await fetchEvmRaw(chainId);
    const cands = evmCandidates(chainId, raw, price, l1GasPriceWei);
    return { primary: choosePrimary(cands), candidates: cands };
  }
  if (chainId === 'sol') {
    const raw = await fetchSolRaw();
    const cands = solCandidates(raw, price);
    return { primary: choosePrimary(cands), candidates: cands };
  }
  if (chainId === 'xrp') {
    const raw = await fetchXrpRaw();
    const cands = xrpCandidates(raw, price);
    return { primary: choosePrimary(cands), candidates: cands };
  }
  return { primary: null, candidates: [] };
}

async function buildSpeed(chainId) {
  if (chainId === 'btc') return btcSpeed();
  if (chainId === 'sol') return solSpeed();
  if (chainId === 'xrp') return xrpSpeed();
  return evmSpeed(chainId);
}

// -------------- Handler --------------
module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const generatedAt = new Date().toISOString();
  try {
    const prices = await getPrices();
    const l1GasPriceWei = await fetchL1GasForL2().catch(() => null);
    const chainIds = ['btc', 'eth', 'bsc', 'sol', 'polygon', 'avax', 'xrp', 'arb', 'op', 'base'];
    const chains = {};
    for (const id of chainIds) {
      try {
        const { primary, candidates } = await buildChain(id, prices, l1GasPriceWei);
        const speedCandidates = await buildSpeed(id);
        const speed = speedStats(speedCandidates);
        chains[id] = {
          ...chainPayload(id, primary, prices?.[id], speed),
          candidates,
          speedCandidates,
        };
      } catch (e) {
        chains[id] = {
          ...chainPayload(id, null, prices?.[id], null),
          candidates: [],
          speedCandidates: [],
        };
      }
    }
    const payload = { generatedAt, chains };
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[snapshot] fatal', e);
    return res.status(200).json({ generatedAt, chains: {} });
  }
};

// test helpers
if (process.env.CFS_TEST) {
  module.exports.__TEST_buildChain = buildChain;
  module.exports.__TEST_buildSpeed = buildSpeed;
  module.exports.__TEST_prices = getPrices;
}
