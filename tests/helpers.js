const assert = require('assert');

function createMockFetch(routes) {
  return async function mockFetch(url, options = {}) {
    const entry = routes.find(r => (typeof r.match === 'function' ? r.match(url, options) : url.includes(r.match)));
    if (!entry) {
      throw new Error(`Unmocked fetch for ${url}`);
    }
    const payload = typeof entry.response === 'function' ? entry.response(url, options) : entry.response;
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

function assertRange(value, min, max, msg) {
  assert(Number.isFinite(value), `${msg || 'value'} must be finite`);
  assert(value >= min, `${msg || 'value'} below min`);
  assert(value <= max, `${msg || 'value'} above max`);
}

module.exports = { createMockFetch, runTest, assertRange };
