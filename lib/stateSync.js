(function initStateSync() {
  const STORAGE_KEY = "cryptofeescope.uiState.v1";
  const QUERY_KEYS = ["q", "chains", "sort", "dir", "currency", "range"];

  function normalizeArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      return value.split(",").map((item) => item.trim());
    }
    return [];
  }

  function normalizeChains(value, allowedChains) {
    const raw = normalizeArray(value)
      .map((item) => item.toLowerCase())
      .filter(Boolean);
    const unique = Array.from(new Set(raw));
    if (!Array.isArray(allowedChains) || !allowedChains.length) {
      return unique;
    }
    const allowedSet = new Set(allowedChains.map((chain) => chain.toLowerCase()));
    return unique.filter((chain) => allowedSet.has(chain));
  }

  function normalizeState(input, config = {}) {
    const result = {};
    if (typeof input?.q === "string") {
      const q = input.q.trim();
      if (q) result.q = q;
    }

    if (input?.chains != null) {
      const chains = normalizeChains(input.chains, config.allowedChains);
      if (chains.length) result.chains = chains;
    }

    if (typeof input?.sort === "string") {
      const sort = input.sort.toLowerCase();
      if (!config.allowedSorts || config.allowedSorts.includes(sort)) {
        result.sort = sort;
      }
    }

    if (typeof input?.dir === "string") {
      const dir = input.dir.toLowerCase();
      if (!config.allowedDirs || config.allowedDirs.includes(dir)) {
        result.dir = dir;
      }
    }

    if (typeof input?.currency === "string") {
      const currency = input.currency.toLowerCase();
      if (!config.allowedCurrencies || config.allowedCurrencies.includes(currency)) {
        result.currency = currency;
      }
    }

    if (typeof input?.range === "string") {
      const range = input.range.toLowerCase();
      if (!config.allowedRanges || config.allowedRanges.includes(range)) {
        result.range = range;
      }
    }

    if (result.sort && !result.dir) {
      delete result.sort;
    }
    if (result.dir && !result.sort) {
      delete result.dir;
    }

    return result;
  }

  function parseQuery(params, config) {
    const raw = {
      q: params.get("q"),
      chains: params.get("chains"),
      sort: params.get("sort"),
      dir: params.get("dir"),
      currency: params.get("currency"),
      range: params.get("range"),
    };
    return normalizeState(raw, config);
  }

  function hasAnyQueryKey(params) {
    return QUERY_KEYS.some((key) => params.has(key));
  }

  function mergeState(defaults, urlState, localState) {
    return {
      ...defaults,
      ...localState,
      ...urlState,
    };
  }

  function areArraysEqual(a, b) {
    if (!Array.isArray(a) && !Array.isArray(b)) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
  }

  function serializeQuery(state, defaults) {
    const params = new URLSearchParams();

    if (state.q && state.q !== defaults.q) {
      params.set("q", state.q);
    }

    if (Array.isArray(state.chains) && state.chains.length) {
      if (!areArraysEqual(state.chains, defaults.chains || [])) {
        params.set("chains", state.chains.join(","));
      }
    }

    if (state.sort && state.dir && (state.sort !== defaults.sort || state.dir !== defaults.dir)) {
      params.set("sort", state.sort);
      params.set("dir", state.dir);
    }

    if (state.currency && state.currency !== defaults.currency) {
      params.set("currency", state.currency);
    }

    if (state.range && state.range !== defaults.range) {
      params.set("range", state.range);
    }

    return params;
  }

  function compactState(state, defaults) {
    const compacted = {};
    if (state.q && state.q !== defaults.q) compacted.q = state.q;
    if (Array.isArray(state.chains) && state.chains.length) {
      if (!areArraysEqual(state.chains, defaults.chains || [])) {
        compacted.chains = state.chains.slice();
      }
    }
    if (state.sort && state.dir && (state.sort !== defaults.sort || state.dir !== defaults.dir)) {
      compacted.sort = state.sort;
      compacted.dir = state.dir;
    }
    if (state.currency && state.currency !== defaults.currency) compacted.currency = state.currency;
    if (state.range && state.range !== defaults.range) compacted.range = state.range;
    return compacted;
  }

  function loadLocalState(config) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return normalizeState(parsed, config);
    } catch (err) {
      return {};
    }
  }

  function saveLocalState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      // ignore storage errors
    }
  }

  window.CryptoFeeScopeStateSync = {
    STORAGE_KEY,
    QUERY_KEYS,
    normalizeState,
    parseQuery,
    serializeQuery,
    hasAnyQueryKey,
    mergeState,
    compactState,
    loadLocalState,
    saveLocalState,
  };
})();
