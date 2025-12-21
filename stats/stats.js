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
    table: document.getElementById('historyTable'),
    chart: document.getElementById('historyChart'),
    status: document.getElementById('loadStatus'),
  };

  const state = {
    chain: DEFAULT_CHAIN,
    range: DEFAULT_RANGE,
    history: [],
    stats: null,
  };

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

  function setStatus(msg) {
    if (!els.status) return;
    els.status.textContent = msg;
  }

  function formatUsd(value) {
    if (value == null || Number.isNaN(value)) return '—';
    const abs = Math.abs(value);
    let digits = 2;
    if (abs < 1) digits = abs < 0.01 ? 6 : 4;
    let out = value.toFixed(digits);
    out = out.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    return `$${out}`;
  }

  function formatTime(ts, range) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    if (range === '7d') {
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  }

  function renderSummary() {
    const s = state.stats;
    els.avg.textContent = formatUsd(s?.feeUsd?.avg);
    els.min.textContent = formatUsd(s?.feeUsd?.min);
    els.max.textContent = formatUsd(s?.feeUsd?.max);
    els.count.textContent = s?.count ?? '—';
    els.updated.textContent = s?.lastTs ? new Date(s.lastTs * 1000).toLocaleString() : '—';
  }

  function renderTable() {
    if (!els.table) return;
    const rows = state.history.slice(-20).reverse();
    if (!rows.length) {
      els.table.innerHTML = '<tr><td colspan="4">No data</td></tr>';
      return;
    }
    els.table.innerHTML = rows.map(pt => {
      const fee = pt.feeUsd == null ? '—' : formatUsd(pt.feeUsd);
      const speed = pt.speedSec == null ? '—' : pt.speedSec;
      const status = pt.status || '—';
      const time = formatTime(pt.ts, state.range);
      return `<tr><td>${time}</td><td>${fee}</td><td>${speed}</td><td>${status}</td></tr>`;
    }).join('');
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
    const points = state.history;
    if (!points.length) return;

    let min = Math.min(...points.map(p => p.feeUsd));
    let max = Math.max(...points.map(p => p.feeUsd));
    if (min === max) {
      const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
      min -= pad;
      max += pad;
    }
    const padY = (max - min) * 0.08;
    min -= padY;
    max += padY;

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
      const yRatio = (pt.feeUsd - min) / (max - min || 1);
      const y = padTop + innerH - innerH * yRatio;
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

  function renderAll() {
    renderSummary();
    renderTable();
    drawLineChart();
  }

  async function fetchStats() {
    const url = `/api/stats?range=${state.range}&chain=${state.chain}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load stats');
    const data = await res.json();
    const match = Array.isArray(data?.chains) ? data.chains.find(c => c.chain === state.chain) : null;
    state.stats = match || null;
  }

  async function fetchHistory() {
    const url = `/api/history?range=${state.range}&chain=${state.chain}&limit=2000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load history');
    const data = await res.json();
    const pts = Array.isArray(data?.points) ? data.points : [];
    state.history = pts
      .filter(p => typeof p.feeUsd === 'number' && typeof p.ts === 'number')
      .sort((a,b) => a.ts - b.ts);
  }

  async function refresh() {
    setStatus('Loading…');
    try {
      await Promise.all([fetchStats(), fetchHistory()]);
      renderAll();
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('Failed to load history');
      renderAll();
    }
  }

  function handleControlEvents() {
    if (els.chain) {
      els.chain.addEventListener('change', (e) => {
        const val = e.target.value;
        state.chain = CHAINS.includes(val) ? val : DEFAULT_CHAIN;
        const params = new URLSearchParams(location.search);
        params.set('chain', state.chain);
        params.set('range', state.range);
        const url = `${location.pathname}?${params.toString()}`;
        history.replaceState(null, '', url);
        syncControls();
        refresh();
      });
    }

    els.rangeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.range;
        if (val && (val === '24h' || val === '7d')) {
          state.range = val;
          const params = new URLSearchParams(location.search);
          params.set('chain', state.chain);
          params.set('range', state.range);
          history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
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

  parseQuery();
  syncControls();
  handleControlEvents();
  setupThemeAndNav();
  setupResize();
  refresh();
})();
