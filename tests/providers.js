const http = require('http');
let fetchImpl = global.fetch;
if (!fetchImpl) {
  try {
    fetchImpl = require('node-fetch');
  } catch (e) {
    // fallback to http for minimal compatibility
    fetchImpl = (url, options = {}) =>
      new Promise((resolve, reject) => {
        const req = http.request(url, { method: options.method || 'GET' }, res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => JSON.parse(data || '{}'),
              text: async () => data,
              headers: new Map(),
            });
          });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
  }
}

function getFetch() {
  return fetchImpl;
}

async function fetchJson(url, options = {}, retries = 2) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      const res = await getFetch()(url, options);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return res.json();
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
      attempt++;
    }
  }
  throw lastErr;
}

const COINGECKO_IDS = {
  btc: 'bitcoin',
  eth: 'ethereum',
  bsc: 'binance-smart-chain',
  sol: 'solana',
  polygon: 'matic-network',
  avax: 'avalanche-2',
  xrp: 'ripple',
  arb: 'arbitrum',
  op: 'optimism',
  base: 'base',
};

async function fetchCoingeckoPrice(chain) {
  const id = COINGECKO_IDS[chain];
  if (!id) throw new Error(`No coingecko id for ${chain}`);
  const data = await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );
  return data?.[id]?.usd ?? null;
}

async function fetchFallbackPrice(chain) {
  const id = COINGECKO_IDS[chain];
  if (!id) return null;
  try {
    const data = await fetchJson(
      `https://api.coinpaprika.com/v1/tickers/${id.replace(/-/g, '')}`
    );
    return data?.quotes?.USD?.price ?? null;
  } catch (e) {
    return null;
  }
}

async function getTokenPriceUSD(chain) {
  try {
    const p = await fetchCoingeckoPrice(chain);
    if (p) return p;
  } catch (e) {
    // swallow
  }
  return fetchFallbackPrice(chain);
}

module.exports = {
  fetchJson,
  getTokenPriceUSD,
  getFetch,
  COINGECKO_IDS,
};
