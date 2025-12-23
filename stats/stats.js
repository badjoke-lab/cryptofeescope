(function initStatsPage(){
  const DEFAULT_CHAIN = 'eth';
  const DEFAULT_RANGE = '24h';
  const CHAINS = ['btc','eth','bsc','sol','tron','avax','xrp','arbitrum','optimism'];
  const els = {
    chain: document.getElementById('chainSelect'),
    rangeButtons: Array.from(document.querySelectorAll('.range-toggle button')),
    avg: document.getElementById('avgFee'),
    min: document.getElementById('minFee'),
    max: document.getElementById('maxFee'),
    count: document.getElementById('count'),
    updated: document.getElementById('updated'),
    freshness: document.getElementById('historyFreshness'),
    table: document.getElementById('historyTable'),
    chart: document.getElementById('historyChart'),
    status: document.getElementById('loadStatus'),
    retry: document.getElementById('retryBtn'),
  };

  const state = {
    chain: DEFAULT_CHAIN,
    range: DEFAULT_RANGE,
    historyRaw: [],
    historyChart: [],
    stats: null,
    meta: null,
    metaHistory: null,
    error: null,
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

  let refreshToken = 0;

  function parseQuery() {
    const params = new URLSearchParams(location.search);
    const chain = params.get('chain');
    const range = params.get('range');
    if (chain && CHAINS.includes(chain)) state.chain = chain;
    if (range === '24h' || range === '7d') state.range = range;
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

  function setStatus(msg, isError = false) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.classList.toggle('error', Boolean(isError));
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

  function formatTime(ts, range) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    if (range === '7d') {
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  }

  function formatAge(ageSec) {
    if (typeof ageSec !== 'number' || !Number.isFinite(ageSec) || ageSec < 0) return '—';
    if (ageSec < 30) return 'just now';
    if (ageSec < 90) return '1 min ago';
    if (ageSec < 3600) return `${Math.round(ageSec / 60)} min ago`;
    if (ageSec < 86400) return `${Math.round(ageSec / 3600)} h ago`;
    return `${Math.round(ageSec / 86400)} d ago`;
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

  function setRetryVisible(show) {
    if (!els.retry) return;
    els.retry.hidden = !show;
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
    const s = state.stats;
    applyFeeText(els.avg, s?.feeUsd?.avg);
    applyFeeText(els.min, s?.feeUsd?.min);
    applyFeeText(els.max, s?.feeUsd?.max);
    els.count.textContent = s?.count ?? '—';
    els.updated.textContent = s?.lastTs ? new Date(s.lastTs * 1000).toLocaleString() : '—';
  }

  function renderTable() {
    if (!els.table) return;
    const rows = state.historyRaw.slice(-20).reverse();
    if (!rows.length) {
      const suffix = lastWrittenText() || DEFAULT_EMPTY_HINT;
      const message = suffix ? `No data yet. ${suffix}` : 'No data yet';
      els.table.innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
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
      tdSpeed.textContent = pt.speedSec == null ? '—' : pt.speedSec;

      const tdStatus = document.createElement('td');
      tdStatus.textContent = pt.status || '—';

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
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const x = padLeft + dx * idx;
      const yRatio = allEqual ? 0.5 : (pt.feeUsd - min) / span;
      const y = padTop + innerH - innerH * yRatio;
      chartUI.points.push({ x, y, ts: pt.ts, feeUsd: pt.feeUsd });
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const step = Math.max(1, Math.floor(n / 6));
    points.forEach((pt, idx) => {
      if (idx % step !== 0 && idx !== n - 1) return;
      const x = padLeft + dx * idx;
      const label = formatTime(pt.ts, state.range);
      ctx.fillText(label, x - 12, height - padBottom + 16);
    });
  }

  function renderFreshness() {
    if (!els.freshness) return;
    if (!state.meta) {
      els.freshness.textContent = 'Loading…';
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

  function renderAll() {
    renderSummary();
    renderTable();
    drawLineChart();
    renderFreshness();
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(`Invalid response from ${url}`);
    }
    if (!data?.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data;
  }

  async function fetchStats() {
    const url = `/api/stats?range=${state.range}&chain=${state.chain}`;
    const payload = await fetchJson(url);
    const data = payload?.data;
    const match = Array.isArray(data?.chains) ? data.chains.find(c => c.chain === state.chain) : null;
    state.stats = match || null;
  }

  async function fetchHistory() {
    const url = `/api/history?range=${state.range}&chain=${state.chain}&limit=2000`;
    const payload = await fetchJson(url);
    const data = payload?.data;
    state.metaHistory = payload?.meta || null;
    const pts = Array.isArray(data?.points) ? data.points : [];
    state.historyRaw = pts
      .map(p => ({
        ...p,
        feeUsd: Number(p.feeUsd),
        ts: Number(p.ts),
      }))
      .filter(p => Number.isFinite(p.feeUsd) && Number.isFinite(p.ts))
      .sort((a,b) => a.ts - b.ts);
    state.historyChart = downsampleHistory(state.historyRaw);
  }

  async function fetchMeta() {
    const payload = await fetchJson('/api/meta');
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
    setStatus('Loading…');
    setRetryVisible(false);
    state.error = null;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      if (refreshToken !== token) return;
      timedOut = true;
      setStatus('Failed to load (timeout)', true);
      setRetryVisible(true);
    }, LOAD_TIMEOUT_MS);
    let aborted = false;
    try {
      await Promise.all([fetchStats(), fetchHistory(), fetchMeta()]);
      if (refreshToken !== token) {
        aborted = true;
        return;
      }
      renderAll();
      const suffix = lastWrittenText();
      if (!state.historyRaw.length) {
        const hint = suffix || DEFAULT_EMPTY_HINT;
        setStatus(hint ? `No data yet. ${hint}` : 'No data yet');
      } else if (isPartialHistory()) {
        setStatus(suffix ? `Data partial. ${suffix}` : 'Data partial');
      } else {
        setStatus('');
      }
    } catch (err) {
      console.error(err);
      state.error = err instanceof Error ? err.message : 'Failed to load history';
      if (refreshToken !== token) {
        aborted = true;
        return;
      }
      renderAll();
      const suffix = lastWrittenText();
      const hint = suffix || DEFAULT_EMPTY_HINT;
      const label = 'Failed to load';
      const extra = state.error && state.error !== label ? `: ${state.error}` : '';
      setStatus(`${label}${extra}${hint ? ` (${hint})` : ''}`, true);
      setRetryVisible(true);
    } finally {
      clearTimeout(timeoutId);
    }
    if (timedOut || aborted) return;
  }

  function handleControlEvents() {
    if (els.retry) {
      els.retry.addEventListener('click', () => {
        refresh();
      });
    }

    if (els.chain) {
      els.chain.addEventListener('change', (e) => {
        const val = e.target.value;
        state.chain = CHAINS.includes(val) ? val : DEFAULT_CHAIN;
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
          syncUrlState();
          syncControls();
          refresh();
        }
      });
    });
  }

  function syncUrlState() {
    const params = new URLSearchParams(location.search);
    params.set('chain', state.chain);
    params.set('range', state.range);
    const next = `${location.pathname}?${params.toString()}`;
    history.replaceState(null, '', next);
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

  parseQuery();
  syncUrlState();
  syncControls();
  handleControlEvents();
  setupThemeAndNav();
  setupChartTooltip();
  setupResize();
  refresh();
})();
