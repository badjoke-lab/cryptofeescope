const { fetchJson } = require('../utils/http');
const { CACHE_MAX_AGE_MS, setCache, getFreshCache, recordFetchError, recordCacheUsage } = require('../utils/fetchCache');
const { tryAll } = require('../utils/fallback');

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  MATIC: 'polygon',
  AVAX: 'avalanche-2',
  SOL: 'solana',
  XRP: 'ripple',
  ARB: 'arbitrum',
  OP: 'optimism',
  BASE: 'base-pro',
};

const CRYPTOCOMPARE_SYMBOLS = {
  BTC: 'BTC',
  ETH: 'ETH',
  BNB: 'BNB',
  MATIC: 'MATIC',
  AVAX: 'AVAX',
  SOL: 'SOL',
  XRP: 'XRP',
  ARB: 'ARB',
  OP: 'OP',
  BASE: 'BASE',
};

const BINANCE_SYMBOLS = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  BNB: 'BNBUSDT',
  MATIC: 'MATICUSDT',
  AVAX: 'AVAXUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
  BASE: 'BASEUSDT',
};

const KUCOIN_SYMBOLS = {
  BTC: 'BTC-USDT',
  ETH: 'ETH-USDT',
  BNB: 'BNB-USDT',
  MATIC: 'MATIC-USDT',
  AVAX: 'AVAX-USDT',
  SOL: 'SOL-USDT',
  XRP: 'XRP-USDT',
  ARB: 'ARB-USDT',
  OP: 'OP-USDT',
  BASE: 'BASE-USDT',
};

const KRAKEN_SYMBOLS = {
  BTC: 'XBTUSD',
  ETH: 'ETHUSD',
  BNB: 'BNBUSD',
  MATIC: 'MATICUSD',
  AVAX: 'AVAXUSD',
  SOL: 'SOLUSD',
  XRP: 'XRPUSD',
  ARB: 'ARBUSD',
  OP: 'OPUSD',
  BASE: 'BASEUSD',
};

const COINBASE_PAIRS = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  BNB: 'BNB-USD',
  MATIC: 'MATIC-USD',
  AVAX: 'AVAX-USD',
  SOL: 'SOL-USD',
  XRP: 'XRP-USD',
  ARB: 'ARB-USD',
  OP: 'OP-USD',
  BASE: 'BASE-USD',
};

const OKX_INSTRUMENTS = {
  BTC: 'BTC-USD-SWAP',
  ETH: 'ETH-USD-SWAP',
  BNB: 'BNB-USD-SWAP',
  MATIC: 'MATIC-USD-SWAP',
  AVAX: 'AVAX-USD-SWAP',
  SOL: 'SOL-USD-SWAP',
  XRP: 'XRP-USD-SWAP',
  ARB: 'ARB-USD-SWAP',
  OP: 'OP-USD-SWAP',
  BASE: 'BASE-USD-SWAP',
};

function parsePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fromCoingecko(symbol, timeout) {
  const id = COINGECKO_IDS[symbol];
  if (!id) return null;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
  const json = await fetchJson(url, { timeout });
  return parsePrice(json?.[id]?.usd);
}

async function fromCryptoCompare(symbol, timeout) {
  const ticker = CRYPTOCOMPARE_SYMBOLS[symbol];
  if (!ticker) return null;
  const url = `https://min-api.cryptocompare.com/data/price?fsym=${ticker}&tsyms=USD`;
  const json = await fetchJson(url, { timeout });
  return parsePrice(json?.USD);
}

async function fromBinance(symbol, timeout) {
  const ticker = BINANCE_SYMBOLS[symbol];
  if (!ticker) return null;
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${ticker}`;
  const json = await fetchJson(url, { timeout });
  return parsePrice(json?.price);
}

async function fromKucoin(symbol, timeout) {
  const ticker = KUCOIN_SYMBOLS[symbol];
  if (!ticker) return null;
  const url = `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${ticker}`;
  const json = await fetchJson(url, { timeout });
  return parsePrice(json?.data?.price);
}

async function fromKraken(symbol, timeout) {
  const ticker = KRAKEN_SYMBOLS[symbol];
  if (!ticker) return null;
  const url = `https://api.kraken.com/0/public/Ticker?pair=${ticker}`;
  const json = await fetchJson(url, { timeout });
  const first = json?.result ? Object.values(json.result)[0] : null;
  return parsePrice(first?.c?.[0]);
}

async function fromCoinbase(symbol, timeout) {
  const pair = COINBASE_PAIRS[symbol];
  if (!pair) return null;
  const url = `https://api.coinbase.com/v2/prices/${pair}/spot`;
  const json = await fetchJson(url, { timeout });
  return parsePrice(json?.data?.amount);
}

async function fromOkx(symbol, timeout) {
  const instrument = OKX_INSTRUMENTS[symbol];
  if (!instrument) return null;
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${instrument}`;
  const json = await fetchJson(url, { timeout });
  return parsePrice(json?.data?.[0]?.last);
}

async function fetchPriceUSD(symbol, options = {}) {
  const now = options.now || new Date();
  const timeout = options.timeout || 10000;
  const cacheKey = `price:${symbol}`;
  const providers = [
    { name: 'coingecko', fn: () => fromCoingecko(symbol, timeout) },
    { name: 'cryptocompare', fn: () => fromCryptoCompare(symbol, timeout) },
    { name: 'binance', fn: () => fromBinance(symbol, timeout) },
    { name: 'kucoin', fn: () => fromKucoin(symbol, timeout) },
    { name: 'kraken', fn: () => fromKraken(symbol, timeout) },
    { name: 'coinbase', fn: () => fromCoinbase(symbol, timeout) },
    { name: 'okx', fn: () => fromOkx(symbol, timeout) },
  ];

  let lastError = null;

  try {
    const result = await tryAll(
      providers.map(p => async () => {
        const price = await p.fn();
        return parsePrice(price) ? { provider: p.name, price } : null;
      }),
      timeout,
      options.totalTimeout || 10000,
    );
    if (result && parsePrice(result.price)) {
      const payload = {
        priceUSD: parsePrice(result.price),
        updated: now.toISOString(),
        provider: result.provider,
        status: 'ok',
      };
      const cachedAt = setCache(cacheKey, payload);
      return { ...payload, source: 'live', cachedAt };
    }
  } catch (err) {
    lastError = err;
  }

  const errorMessage = lastError ? lastError.message : 'all price providers failed';
  recordFetchError(cacheKey, errorMessage);
  const cached = getFreshCache(cacheKey, CACHE_MAX_AGE_MS);
  if (cached) {
    recordCacheUsage(cacheKey, cached.ageMs);
    return {
      ...cached.data,
      source: 'cache',
      cachedAt: cached.cachedAt,
      cacheAgeMinutes: Math.round(cached.ageMs / 60000),
    };
  }

  return {
    priceUSD: null,
    updated: now.toISOString(),
    provider: null,
    status: 'api-failed',
    source: null,
    error: errorMessage,
  };
}

module.exports = { fetchPriceUSD };
