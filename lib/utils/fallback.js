const { fetchJson } = require('./http');

function isValidNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function pickValid(values) {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    if (isValidNumber(value)) return Number(value);
  }
  return null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function tryAll(providers, perTimeout = 600, totalTimeout = 4000) {
  const started = Date.now();
  let lastError = null;
  for (const provider of providers) {
    const remaining = totalTimeout - (Date.now() - started);
    if (remaining <= 0) break;
    const budget = Math.min(perTimeout, remaining);
    try {
      const result = await withTimeout(provider(), budget);
      if (result !== null && result !== undefined) return result;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function fetchJsonQuick(url, timeout) {
  return fetchJson(url, { timeout });
}

module.exports = { pickValid, tryAll, withTimeout, isValidNumber, fetchJsonQuick };
