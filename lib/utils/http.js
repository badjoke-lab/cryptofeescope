function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

function isRetryableError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.message === 'timeout') return true;
  const code = err.code || err.errno;
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) {
    return true;
  }
  if (typeof err.status === 'number') {
    return false;
  }
  return err instanceof TypeError;
}

async function fetchJson(url, options = {}) {
  const { timeout = 10000, retry = 1, ...rest } = options;
  const fetchImpl = global.fetch;
  if (!fetchImpl) throw new Error('global fetch unavailable');
  const method = rest.method ? String(rest.method).toUpperCase() : 'GET';
  const attempts = method === 'GET' ? Math.max(1, retry + 1) : 1;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await Promise.race([
        fetchImpl(url, { ...rest, signal: controller.signal }),
        timeoutPromise(timeout),
      ]);
      if (!res || !res.ok) {
        const body = res && res.text ? await res.text().catch(() => '') : '';
        const error = new Error(`HTTP ${res ? res.status : 'ERR'} ${body}`);
        error.status = res ? res.status : null;
        throw error;
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1 && isRetryableError(err)) {
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

module.exports = { fetchJson, toNumber };
