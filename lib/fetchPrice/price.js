const { fetchJson, toNumber } = require('../utils/http');

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
  SOL: 'solana',
  XRP: 'ripple',
};

const BINANCE_SYMBOLS = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  BNB: 'BNBUSDT',
  MATIC: 'MATICUSDT',
  AVAX: 'AVAXUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

async function fromCoingecko(symbol) {
  const id = COINGECKO_IDS[symbol];
  if (!id) return null;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
  const json = await fetchJson(url, { timeout: 8000 });
  return toNumber(json?.[id]?.usd);
}

async function fromCryptoCompare(symbol) {
  const url = `https://min-api.cryptocompare.com/data/price?fsym=${symbol}&tsyms=USD`;
  const json = await fetchJson(url, { timeout: 8000 });
  return toNumber(json?.USD);
}

async function fromBinance(symbol) {
  const ticker = BINANCE_SYMBOLS[symbol];
  if (!ticker) return null;
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${ticker}`;
  const json = await fetchJson(url, { timeout: 8000 });
  return toNumber(json?.price);
}

async function fetchPriceUSD(symbol, options = {}) {
  const now = options.now || new Date();
  const attempts = [
    { name: 'coingecko', fn: fromCoingecko },
    { name: 'cryptocompare', fn: fromCryptoCompare },
    { name: 'binance', fn: fromBinance },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const price = await attempt.fn(symbol);
      if (Number.isFinite(price) && price > 0) {
        return { priceUSD: price, updated: now.toISOString(), source: attempt.name, status: 'ok' };
      }
    } catch (e) {
      lastError = e;
    }
  }

  return {
    priceUSD: null,
    updated: now.toISOString(),
    source: null,
    status: 'api-failed',
    error: lastError ? lastError.message : 'all providers failed',
  };
}

module.exports = { fetchPriceUSD };
