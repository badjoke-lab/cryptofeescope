(function initStatsPage(){
  const DEFAULT_CHAIN = 'eth';
  const DEFAULT_RANGE = '24h';
  const CHAINS = [
    'btc',
    'eth',
    'bsc',
    'sol',
    'tron',
    'avax',
    'xrp',
    'arbitrum',
    'optimism',
    'gnosis',
    'fantom',
    'cronos',
  ];
  const URL_STATE_DEFAULTS = {
    q: '',
    chains: [DEFAULT_CHAIN],
    sort: null,
    dir: null,
    currency: 'usd',
    range: DEFAULT_RANGE,
  };
  const URL_STATE_CONFIG = {
    allowedChains: CHAINS,
    allowedSorts: ['fee', 'speed', 'chain'],
    allowedDirs: ['asc', 'desc'],
    allowedCurrencies: ['usd', 'jpy'],
    allowedRanges: ['24h', '7d'],
  };
  const els = {
    chain: document.getElementById('chainSelect'),
    rangeButtons: Array.from(document.querySelectorAll('.range-toggle button')),
    avg: document.getElementById('avgFee'),
    min: document.getElementById('minFee'),
    max: document.getElementById('maxFee'),
    count: document.getElementById('count'),
    updated: document.getElementById('updated'),
    freshness: document.getElementById('historyFreshness'),
    health: document.getElementById('healthBadge'),
    table: document.getElementById('historyTable'),
    chart: document.getElementById('historyChart'),
  };

  const pageState = window.CryptoFeeScopePageState?.createPageState('stats-state');
  const safeFetchJson = window.CryptoFeeScopePageState?.safeFetchJson;
  const normalizeError = window.CryptoFeeScopePageState?.normalizeError;

  const state = {
    chain: DEFAULT_CHAIN,
    range: DEFAULT_RANGE,
    historyRaw: [],
    historyChart: [],
    stats: null,
    meta: null,
    metaHistory: null,
    error: null,
    viewMode: 'loading',
  };

  const chartUI = {
    points: [],
    tooltip: null,
  };

  const CHART_LIMITS = {
    max: 300,
    ideal: 300,
  };
  const LOAD_TIMEOUT_MS = 10000;
  const DEFAULT_EMPTY_HINT = 'Wait for next cron write';
  const INSUFFICIENT_LABEL = '—';
  const INSUFFICIENT_TITLES = {
    too_few_points: 'Insufficient data',
    gap_too_large: 'Data missing',
  };
  const STATUS_LABELS = {
    fast: 'Fast',
    normal: 'Normal',
    slow: 'Slow',
    degraded: 'Degraded',
  };
  const DEGRADED_STATUSES = new Set(['unknown', 'error', 'degraded']);
  const GAP_THRESHOLDS = {
    '24h': 6 * 60 * 60,
    '7d': 24 * 60 * 60,
  };

  let refreshToken = 0;
  const urlSync = window.CryptoFeeScopeStateSync;
  let urlState = { ...URL_STATE_DEFAULTS };
  let lastSyncedQuery = '';
  let skipNextLocalSave = false;

  function setUrlState(partial) {
    if (!urlSync) return;
    const normalized = urlSync.normalizeState(partial, URL_STATE_CONFIG);
    const next = { ...urlState };
    Object.keys(partial).forEach((key) => {
      if (normalized[key] !== undefined) {
        next[key] = normalized[key];
      } else if (key in URL_STATE_DEFAULTS) {
        next[key] = URL_STATE_DEFAULTS[key];
      }
    });
    urlState = { ...URL_STATE_DEFAULTS, ...next };
  }

  function syncUrlState() {
    if (!urlSync) return;
    const params = urlSync.serializeQuery(urlState, URL_STATE_DEFAULTS);
    const queryString = params.toString();
    const next = queryString ? `${location.pathname}?${queryString}` : location.pathname;
    const current = location.pathname + location.search;
    if (next !== current) {
      history.replaceState(null, '', next);
    }
    lastSyncedQuery = queryString;
    if (!skipNextLocalSave) {
      const compacted = urlSync.compactState(urlState, URL_STATE_DEFAULTS);
      urlSync.saveLocalState(compacted);
    }
    skipNextLocalSave = false;
  }

  function applyUrlStateToUi(nextState) {
    const chain = Array.isArray(nextState.chains) ? nextState.chains[0] : null;
    state.chain = chain && CHAINS.includes(chain) ? chain : DEFAULT_CHAIN;
    state.range = nextState.range || DEFAULT_RANGE;
  }

  function initializeUrlState() {
    if (!urlSync) return;
    const params = new URLSearchParams(location.search);
    const hasUrlState = urlSync.hasAnyQueryKey(params);
    const urlParsed = hasUrlState ? urlSync.parseQuery(params, URL_STATE_CONFIG) : {};
    const localParsed = !hasUrlState ? urlSync.loadLocalState(URL_STATE_CONFIG) : {};
    urlState = urlSync.mergeState(URL_STATE_DEFAULTS, urlParsed, localParsed);
    applyUrlStateToUi(urlState);
    lastSyncedQuery = params.toString();
    skipNextLocalSave = !hasUrlState;
    syncUrlState();
  }

  function handlePopState() {
    if (!urlSync) return;
    const params = new URLSearchParams(location.search);
    const queryString = params.toString();
    if (queryString === lastSyncedQuery) return;
    const hasUrlState = urlSync.hasAnyQueryKey(params);
    const urlParsed = hasUrlState ? urlSync.parseQuery(params, URL_STATE_CONFIG) : {};
    const localParsed = !hasUrlState ? urlSync.loadLocalState(URL_STATE_CONFIG) : {};
    urlState = urlSync.mergeState(URL_STATE_DEFAULTS, urlParsed, localParsed);
    applyUrlStateToUi(urlState);
    syncControls();
    refresh();
    lastSyncedQuery = queryString;
  }

  function syncControls() {
    if (els.chain) els.chain.value = state.chain;
    els.rangeButtons.forEach(btn => {
      const active = btn.dataset.range === state.range;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-secondary', !active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setViewMode(mode, options = {}) {
    state.viewMode = mode;
    pageState?.setState(mode, options);
  }

  function formatFeeParts(value) {
    return typeof formatFeeUSD === 'function'
      ? formatFeeUSD(value)
      : { display: '—', exact: '' };
  }

  function applyFeeText(el, value) {
    if (!el) return;
    const parts = formatFeeParts(value);
    if (typeof renderFeeValue === 'function') {
      renderFeeValue(el, parts);
      return;
    }

    el.textContent = parts.display;
  }

  function isValidFeeValue(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  function getInsufficientTitle(stats) {
    if (!stats || stats.status !== 'insufficient') return '';
    return INSUFFICIENT_TITLES[stats.reason] || 'Insufficient data';
  }

  function formatTime(ts, range) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    if (range === '7d') {
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  }

  function normalizeStatus(status) {
    const raw = (status || 'unknown').toLowerCase();
    return DEGRADED_STATUSES.has(raw) ? 'degraded' : raw;
  }

  function formatStatusLabel(status) {
    if (!status) return '—';
    const normalized = normalizeStatus(status);
    return STATUS_LABELS[normalized] || 'Degraded';
  }

  function formatAge(ageSec) {
    if (typeof ageSec !== 'number' || !Number.isFinite(ageSec) || ageSec < 0) return '—';
    if (ageSec < 30) return 'just now';
    if (ageSec < 90) return '1 min ago';
    if (ageSec < 3600) return `${Math.round(ageSec / 60)} min ago`;
    if (ageSec < 86400) return `${Math.round(ageSec / 3600)} h ago`;
    return `${Math.round(ageSec / 86400)} d ago`;
  }

  function parseIsoToUnix(iso) {
    if (typeof iso !== 'string') return null;
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return null;
    return Math.floor(parsed / 1000);
  }

  function resolveMetaTimestamp(meta, tsKey, isoKey) {
    if (meta && typeof meta[tsKey] === 'number') return meta[tsKey];
    return parseIsoToUnix(meta?.[isoKey]);
  }

  function formatTickTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function maxTickLabels(width) {
    if (width < 360) return 3;
    if (width < 480) return 4;
    if (width < 640) return 6;
    return 8;
  }

  function buildTickIndexes(count, width) {
    if (count <= 0) return [];
    if (count === 1) return [0];
    const target = Math.min(maxTickLabels(width), count);
    if (target === 1) return [count - 1];
    const step = (count - 1) / (target - 1);
    const idxs = [];
    for (let i = 0; i < target; i++) {
      idxs.push(Math.round(i * step));
    }
    idxs.push(count - 1);
    const unique = Array.from(new Set(idxs)).sort((a, b) => a - b);
    while (unique.length > target) {
      unique.splice(unique.length - 2, 1);
    }
    return unique;
  }

  function downsampleHistory(points) {
    if (state.range !== '7d' || points.length <= CHART_LIMITS.max) return points.slice();
    const first = points[0];
    const last = points[points.length - 1];
    const spanSec = Math.max(1, last.ts - first.ts);
    const targetBuckets = Math.max(1, CHART_LIMITS.ideal - 2);
    const bucketSize = Math.max(1, Math.ceil(spanSec / targetBuckets));

    const extremes = [];
    let bucketStart = Math.floor(first.ts / bucketSize) * bucketSize;
    let idx = 0;
    while (bucketStart <= last.ts && idx < points.length) {
      const bucketEnd = bucketStart + bucketSize;
      let minPt = null;
      let maxPt = null;
      while (idx < points.length && points[idx].ts < bucketEnd) {
        const pt = points[idx];
        if (!minPt || pt.feeUsd < minPt.feeUsd) minPt = pt;
        if (!maxPt || pt.feeUsd > maxPt.feeUsd) maxPt = pt;
        idx += 1;
      }
      if (minPt) extremes.push(minPt);
      if (maxPt && maxPt !== minPt) extremes.push(maxPt);
      bucketStart = bucketEnd;
    }

    const merged = [first, ...extremes, last]
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);

    const deduped = [];
    const seen = new Set();
    merged.forEach(pt => {
      const key = `${pt.ts}-${pt.feeUsd}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(pt);
    });

    while (deduped.length > CHART_LIMITS.max) {
      deduped.splice(Math.floor(deduped.length / 2), 1);
    }

    return deduped;
  }

  function ensureTooltip() {
    if (chartUI.tooltip || !els.chart) return;
    const wrap = els.chart.parentElement;
    if (!wrap) return;
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip hidden';
    wrap.appendChild(tip);
    chartUI.tooltip = tip;
  }

  function hideTooltip() {
    if (!chartUI.tooltip) return;
    chartUI.tooltip.classList.add('hidden');
  }

  function showTooltip(pt) {
    if (!chartUI.tooltip) return;
    const parts = formatFeeParts(pt.feeUsd);
    const rawText = parts.raw || parts.exact;
    const rawLine = rawText ? `<div class="tooltip-raw">Exact: ${rawText}</div>` : '';
    chartUI.tooltip.innerHTML = `<div class="tooltip-time">${formatTime(pt.ts, state.range)}</div><div class="tooltip-value">${parts.display}</div>${rawLine}`;
    chartUI.tooltip.style.left = `${pt.x}px`;
    chartUI.tooltip.style.top = `${pt.y}px`;
    chartUI.tooltip.classList.remove('hidden');
  }

  function findNearestPoint(x) {
    if (!chartUI.points.length) return null;
    let best = chartUI.points[0];
    let bestDist = Math.abs(x - best.x);
    for (let i = 1; i < chartUI.points.length; i++) {
      const dist = Math.abs(x - chartUI.points[i].x);
      if (dist < bestDist) {
        best = chartUI.points[i];
        bestDist = dist;
      }
    }
    return best;
  }

  function handleChartPointer(evt) {
    if (!els.chart) return;
    const rect = els.chart.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const x = clientX - rect.left;
    const nearest = findNearestPoint(x);
    if (!nearest) {
      hideTooltip();
      return;
    }
    showTooltip(nearest);
  }

  function setupChartTooltip() {
    if (!els.chart) return;
    ensureTooltip();
    els.chart.addEventListener('mousemove', handleChartPointer);
    els.chart.addEventListener('mouseleave', hideTooltip);
    els.chart.addEventListener('touchstart', handleChartPointer, { passive: true });
    els.chart.addEventListener('touchmove', handleChartPointer, { passive: true });
    els.chart.addEventListener('touchend', hideTooltip);
  }

  function renderSummary() {
    if (state.viewMode !== 'ok') {
      if (els.avg) els.avg.textContent = '—';
      if (els.min) els.min.textContent = '—';
      if (els.max) els.max.textContent = '—';
      if (els.count) els.count.textContent = '—';
      if (els.updated) els.updated.textContent = '—';
      return;
    }
    const s = state.stats;
    const insufficientTitle = getInsufficientTitle(s);
    const isInsufficient = s?.status === 'insufficient';
    if (isInsufficient) {
      if (els.avg) els.avg.textContent = INSUFFICIENT_LABEL;
      if (els.min) els.min.textContent = INSUFFICIENT_LABEL;
      if (els.max) els.max.textContent = INSUFFICIENT_LABEL;
      if (els.count) els.count.textContent = INSUFFICIENT_LABEL;
      if (els.updated) els.updated.textContent = INSUFFICIENT_LABEL;
    } else {
      applyFeeText(els.avg, s?.feeUsd?.avg);
      applyFeeText(els.min, s?.feeUsd?.min);
      applyFeeText(els.max, s?.feeUsd?.max);
      if (els.count) els.count.textContent = s?.count ?? '—';
      if (els.updated) {
        els.updated.textContent = s?.lastTs ? new Date(s.lastTs * 1000).toLocaleString() : '—';
      }
    }
    [els.avg, els.min, els.max, els.count, els.updated].forEach(el => {
      if (!el) return;
      if (insufficientTitle) {
        el.title = insufficientTitle;
      } else {
        el.removeAttribute('title');
      }
    });
  }

  function renderTable() {
    if (!els.table) return;
    const rows = state.historyRaw.slice(-20).reverse();
    if (!rows.length) {
      if (state.viewMode === 'ok') {
        const suffix = lastWrittenText() || DEFAULT_EMPTY_HINT;
        const message = suffix ? `No data yet. ${suffix}` : 'No data yet';
        els.table.innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
      } else {
        els.table.textContent = '';
      }
      return;
    }
    els.table.textContent = '';

    rows.forEach(pt => {
      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      tdTime.textContent = formatTime(pt.ts, state.range);

      const tdFee = document.createElement('td');
      tdFee.className = 'fee-cell';
      const feeParts = formatFeeParts(pt.feeUsd);
      if (typeof renderFeeValue === 'function') {
        renderFeeValue(tdFee, feeParts);
      } else {
        tdFee.textContent = feeParts.display;
      }

      const tdSpeed = document.createElement('td');
      tdSpeed.textContent = pt.speedSec == null ? '—' : `${pt.speedSec} sec`;

      const tdStatus = document.createElement('td');
      tdStatus.textContent = formatStatusLabel(pt.status);

      tr.append(tdTime, tdFee, tdSpeed, tdStatus);
      els.table.appendChild(tr);
    });
  }

  function drawLineChart() {
    const canvas = els.chart;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const parent = canvas.parentElement;
    const width = (parent && parent.clientWidth) ? parent.clientWidth : 640;
    const height = canvas.height || 260;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);
    if (state.viewMode !== 'ok') return;
    if (state.stats?.status === 'insufficient') {
      chartUI.points = [];
      hideTooltip();
      ctx.fillStyle = '#64748b';
      ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Insufficient data', width / 2, height / 2);
      return;
    }
    const points = state.historyChart;
    chartUI.points = [];
    hideTooltip();
    if (!points.length) return;

    const fees = points.map(p => p.feeUsd);
    const minVal = Math.min(...fees);
    const maxVal = Math.max(...fees);
    const allEqual = minVal === maxVal;
    let min = minVal;
    let max = maxVal;
    if (!allEqual) {
      const padY = (max - min) * 0.08;
      min -= padY;
      max += padY;
    }
    const span = allEqual ? 1 : (max - min || 1);

    const padLeft = 36;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 28;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;

    ctx.strokeStyle = 'rgba(15,23,42,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, height - padBottom);
    ctx.lineTo(width - padRight, height - padBottom);
    ctx.stroke();

    const n = points.length;
    const dx = n > 1 ? innerW / (n - 1) : 0;
    const gapThreshold = GAP_THRESHOLDS[state.range];
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const x = padLeft + dx * idx;
      const yRatio = allEqual ? 0.5 : (pt.feeUsd - min) / span;
      const y = padTop + innerH - innerH * yRatio;
      chartUI.points.push({ x, y, ts: pt.ts, feeUsd: pt.feeUsd });
      if (idx === 0) {
        ctx.moveTo(x, y);
        return;
      }
      const prev = points[idx - 1];
      const gap = gapThreshold && prev ? pt.ts - prev.ts : 0;
      if (gapThreshold && gap > gapThreshold) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tickIdxs = buildTickIndexes(points.length, width);
    tickIdxs.forEach(idx => {
      const pt = points[idx];
      const x = padLeft + dx * idx;
      const label = formatTickTime(pt.ts);
      ctx.fillText(label, x, height - padBottom + 12);
    });
  }

  function renderFreshness() {
    if (!els.freshness) return;
    if (!state.meta || state.viewMode !== 'ok') {
      els.freshness.textContent = '—';
      return;
    }
    const latest = state.meta.latestTsByChain?.[state.chain];
    if (typeof latest !== 'number') {
      els.freshness.textContent = '—';
      return;
    }
    const age = state.meta.nowTs - latest;
    els.freshness.textContent = formatAge(age);
  }

  function renderHealth() {
    if (!els.health) return;
    if (!state.meta) {
      els.health.textContent = 'Health: —';
      els.health.classList.remove('stale');
      return;
    }
    const nowTs = typeof state.meta.nowTs === 'number' ? state.meta.nowTs : Math.floor(Date.now() / 1000);
    const lastWriteTs =
      resolveMetaTimestamp(state.meta, 'lastWrittenAt', 'lastWriteAt') ??
      resolveMetaTimestamp(state.meta, 'latestTsOverall', 'lastWriteAt');
    const lastOkTs = resolveMetaTimestamp(state.meta, 'lastOkTs', 'lastOkAt');
    const stale = state.meta.stale === true;
    const reason = typeof state.meta.staleReason === 'string' ? state.meta.staleReason : null;
    els.health.classList.toggle('stale', stale);

    if (stale) {
      if (reason === 'no_write') {
        els.health.textContent = 'Health: STALE · no writes yet';
        return;
      }
      if (reason === 'write_too_old') {
        const age = lastWriteTs != null ? formatAge(nowTs - lastWriteTs) : '—';
        els.health.textContent = `Health: STALE · last write ${age}`;
        return;
      }
      if (reason === 'ok_too_old') {
        const age = lastOkTs != null ? formatAge(nowTs - lastOkTs) : '—';
        els.health.textContent = `Health: STALE · last ok ${age}`;
        return;
      }
      els.health.textContent = 'Health: STALE';
      return;
    }

    const updatedAge = lastWriteTs != null ? formatAge(nowTs - lastWriteTs) : '—';
    let label = `Health: OK · updated ${updatedAge}`;
    const gapHours = typeof state.meta.maxGapHours24h === 'number' ? state.meta.maxGapHours24h : null;
    if (gapHours != null && gapHours >= 6) {
      label += ` (gap ${Math.round(gapHours)}h)`;
    }
    els.health.textContent = label;
  }

  function renderAll() {
    renderSummary();
    renderTable();
    drawLineChart();
    renderFreshness();
    renderHealth();
  }

  async function fetchJson(url, validate) {
    if (typeof safeFetchJson !== 'function') {
      const res = await fetch(url);
      const data = await res.json();
      if (!data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      return data;
    }

    return safeFetchJson(url, {}, (payload) => {
      if (!payload || payload.ok !== true) {
        return payload?.error || 'Request failed';
      }
      if (typeof validate === 'function') return validate(payload);
      return null;
    });
  }

  async function fetchStats() {
    const url = `/api/stats?range=${state.range}&chain=${state.chain}`;
    const payload = await fetchJson(url, (data) => {
      if (!data?.data?.chains || !Array.isArray(data.data.chains)) {
        return 'Invalid stats payload';
      }
      return null;
    });
    const data = payload?.data;
    const match = Array.isArray(data?.chains) ? data.chains.find(c => c.chain === state.chain) : null;
    state.stats = match || null;
  }

  async function fetchHistory() {
    const url = `/api/history?range=${state.range}&chain=${state.chain}&limit=2000`;
    const payload = await fetchJson(url, (data) => {
      if (!data?.data || !Array.isArray(data.data.points)) {
        return 'Invalid history payload';
      }
      return null;
    });
    const data = payload?.data;
    state.metaHistory = payload?.meta || null;
    const pts = Array.isArray(data?.points) ? data.points : [];
    state.historyRaw = pts
      .map(p => ({
        ...p,
        feeUsd: Number(p.feeUsd),
        ts: Number(p.ts),
      }))
      .filter(p => isValidFeeValue(p.feeUsd) && Number.isFinite(p.ts))
      .sort((a,b) => a.ts - b.ts);
    state.historyChart = downsampleHistory(state.historyRaw);
  }

  async function fetchMeta() {
    const payload = await fetchJson('/api/meta', (data) => {
      if (!data?.data || typeof data.data !== 'object') {
        return 'Invalid meta payload';
      }
      return null;
    });
    state.meta = payload?.data || null;
  }

  function lastWrittenText() {
    const ts = state.metaHistory?.newestTs || state.meta?.lastWrittenAt || state.meta?.latestTsOverall;
    if (!ts) return '';
    return `Last written at ${new Date(ts * 1000).toLocaleString()}`;
  }

  function isPartialHistory() {
    if (!state.metaHistory) return false;
    if (state.metaHistory.downsampled) return true;
    const original = Number(state.metaHistory.originalCount || 0);
    const current = Number(state.metaHistory.count || state.historyRaw.length || 0);
    return original > 0 && current > 0 && original > current;
  }

  async function refresh() {
    const token = ++refreshToken;
    setViewMode('loading', {
      title: 'Loading...',
      message: 'Fetching the latest stats.',
    });
    state.error = null;
    state.stats = null;
    state.historyRaw = [];
    state.historyChart = [];
    state.metaHistory = null;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      if (refreshToken !== token) return;
      timedOut = true;
      setViewMode('error', {
        title: 'Request timed out',
        message: 'The API did not respond in time.',
        onRetry: refresh,
      });
    }, LOAD_TIMEOUT_MS);
    let aborted = false;
    try {
      await Promise.all([fetchStats(), fetchHistory(), fetchMeta()]);
      if (refreshToken !== token) {
        aborted = true;
        return;
      }
      const suffix = lastWrittenText();
      if (!state.historyRaw.length) {
        const hint = suffix || DEFAULT_EMPTY_HINT;
        const message = hint
          ? `History is still building. ${hint}`
          : 'History is still building.';
        setViewMode('empty', {
          title: 'No data yet',
          message: `${message} Try range=24h or check back later.`,
          onRetry: refresh,
        });
      } else if (state.historyRaw.length < 2) {
        const hint = suffix || DEFAULT_EMPTY_HINT;
        const message = hint
          ? `Not enough points yet. ${hint}`
          : 'Not enough points yet.';
        setViewMode('empty', {
          title: 'Not enough data',
          message: `${message} Try range=24h or check back later.`,
          onRetry: refresh,
        });
      } else {
        setViewMode('ok');
      }
      renderAll();
    } catch (err) {
      console.error(err);
      state.error = err instanceof Error ? err.message : 'Failed to load history';
      if (refreshToken !== token) {
        aborted = true;
        return;
      }
      const normalized = typeof normalizeError === 'function'
        ? normalizeError(err)
        : { title: 'Request failed', message: state.error, details: err?.stack || '' };
      setViewMode('error', {
        title: normalized.title,
        message: normalized.message || state.error,
        details: normalized.details,
        onRetry: refresh,
      });
      renderAll();
    } finally {
      clearTimeout(timeoutId);
    }
    if (timedOut || aborted) return;
  }

  function handleControlEvents() {
    if (els.chain) {
      els.chain.addEventListener('change', (e) => {
        const val = e.target.value;
        state.chain = CHAINS.includes(val) ? val : DEFAULT_CHAIN;
        setUrlState({ chains: [state.chain] });
        syncUrlState();
        syncControls();
        refresh();
      });
    }

    els.rangeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.range;
        if (val && (val === '24h' || val === '7d')) {
          state.range = val;
          setUrlState({ range: state.range });
          syncUrlState();
          syncControls();
          refresh();
        }
      });
    });
  }

  function setupThemeAndNav() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const saved = localStorage.getItem('theme');
    const initial = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', initial);

    const btn = document.getElementById('themeBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      });
    }

    const nav = document.getElementById('global-nav');
    const toggle = document.getElementById('nav-toggle');
    const syncNav = () => {
      if (!nav || !toggle) return;
      if (window.innerWidth > 768) {
        nav.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    };
    if (nav && toggle) {
      toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      window.addEventListener('resize', syncNav);
      syncNav();
    }
  }

  function setupResize() {
    let rafId = 0;
    window.addEventListener('resize', () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(drawLineChart);
    });
  }

  initializeUrlState();
  syncControls();
  handleControlEvents();
  window.addEventListener('popstate', handlePopState);
  setupThemeAndNav();
  setupChartTooltip();
  setupResize();
  refresh();
})();
