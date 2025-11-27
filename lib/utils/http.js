function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function fetchJson(url, options = {}) {
  const { timeout = 12000, ...rest } = options;
  const fetchImpl = global.fetch;
  if (!fetchImpl) throw new Error('global fetch unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await Promise.race([
      fetchImpl(url, { ...rest, signal: controller.signal }),
      timeoutPromise(timeout),
    ]);
    if (!res || !res.ok) {
      const body = res && res.text ? await res.text().catch(() => '') : '';
      throw new Error(`HTTP ${res ? res.status : 'ERR'} ${body}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

module.exports = { fetchJson, toNumber };
