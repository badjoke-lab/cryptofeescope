const { fetchJson, toNumber } = require('../utils/http');
const { median } = require('../utils/median');

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  MATIC: 'polygon',
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

async function fromCoinbase(symbol) {
  const pair = `${symbol}-USD`;
  const url = `https://api.coinbase.com/v2/prices/${pair}/spot`;
  const json = await fetchJson(url, { timeout: 8000 });
  return toNumber(json?.data?.amount);
}

async function fetchPriceUSD(symbol, options = {}) {
  const now = options.now || new Date();
  const attempts = [];
  const sources = [fromCoingecko, fromCryptoCompare, fromBinance, fromCoinbase];
  for (const fn of sources) {
    try {
      const price = await fn(symbol);
      if (price) attempts.push(price);
    } catch (e) {
      // ignore and continue to next source
    }
  }
  const value = median(attempts);
  if (!Number.isFinite(value)) {
    throw new Error(`price unavailable for ${symbol}`);
  }
  return { priceUSD: value, updated: now.toISOString(), sourcesTried: sources.length };
}

module.exports = { fetchPriceUSD };
