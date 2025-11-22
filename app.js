// ========== CryptoFeeScope — snapshot + history + fee details tooltip ==========

// ----- Theme -----
const THEME_KEY = 'cfs-theme';

function getInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  document.body.classList.toggle('dark', t === 'dark');
  localStorage.setItem(THEME_KEY, t);
}

// 初期テーマ適用は DOMContentLoaded 内で行う

// ----- DOM refs -----
const TBL = {
  status: document.getElementById('status'),
  q: document.getElementById('q'),
  priority: document.getElementById('priority'),
  fiat: document.getElementById('fiat'),
  tbody: document.getElementById('tbody'),
  historyCanvas: document.getElementById('historyCanvas'),
  historyChain: document.getElementById('historyChain'),
  feeHeader: document.getElementById('feeHeader'),
};

const REFRESH_BTN = document.getElementById('refreshBtn');
const THEME_BTN = document.getElementById('themeBtn');

// ----- Config -----
const FIAT_CONFIG = {
  USD: { symbol: '$', key: 'usd' },
  JPY: { symbol: '¥', key: 'jpy' },
};

// チェーン定義（表示順）
const CHAINS = [
  { id: 'btc', name: 'Bitcoin (L1)', ticker: 'BTC', family: 'bitcoin' },
  { id: 'eth', name: 'Ethereum (L1)', ticker: 'ETH', family: 'evm' },
  { id: 'sol', name: 'Solana (L1)', ticker: 'SOL', family: 'solana' },
  { id: 'arb', name: 'Arbitrum (L2 on ETH)', ticker: 'ARB', family: 'evm' },
  { id: 'op',  name: 'Optimism (L2 on ETH)', ticker: 'OP',  family: 'evm' },
  { id: 'base', name: 'Base (L2 on ETH)', ticker: 'BASE', family: 'evm' },
  { id: 'polygon', name: 'Polygon', ticker: 'MATIC', family: 'evm' },
  { id: 'bsc', name: 'BNB Smart Chain', ticker: 'BNB', family: 'evm' },
];

const STATE = {
  snapshot: null,      // { [id]: { feeUSD, feeJPY, speedSec, status, updated, tiers } }
  history: {},         // { [chainId]: [{ ts, feeUSD }] }
  fiat: 'USD',
  priority: 'standard',
  search: '',
  lastUpdated: null,
  openDetails: null,
};

let AUTO_REFRESH_TIMER = null;

// ----- Helpers -----
function showStatus(text, type = 'ok') {
  if (!TBL.status) return;
  TBL.status.textContent = text;
  TBL.status.dataset.variant = type;
}

function fmtTime(date) {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtSpeed(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  if (sec < 90) return `${Math.round(sec)} s`;
  const m = sec / 60;
  return `${m.toFixed(1)} min`;
}

function fmtTierSpeed(sec, preferMinutes = false) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  if (preferMinutes) {
    const m = Math.max(1, Math.round(sec / 60));
    return `${m} min`;
  }
  const s = Math.max(1, Math.round(sec));
  return `${s} sec`;
}

function fmtFiat(feeUsd, feeJpy, fiat) {
  const cfg = FIAT_CONFIG[fiat] || FIAT_CONFIG.USD;
  const value = fiat === 'JPY'
    ? (Number.isFinite(feeJpy) ? feeJpy : feeUsd)
    : feeUsd;

  if (value == null || !Number.isFinite(value)) return '—';

  if (fiat === 'USD') {
    if (value < 0.001) return '< $0.001';
    return `${cfg.symbol}${value.toFixed(3)}`;
  }

  return `${cfg.symbol}${value.toFixed(2)}`;
}

function decideStatusTag(sec, status) {
  if (status === 'failed') return { label: 'Failed', className: 'bad' };
  if (status === 'fast') return { label: 'Fast', className: 'good' };
  if (status === 'slow') return { label: 'Slow', className: 'warn' };
  if (status === 'avg') return { label: 'Avg', className: '' };
  if (sec == null || !Number.isFinite(sec)) return { label: 'Avg', className: '' };
  if (sec <= 60) return { label: 'Fast', className: 'good' };
  if (sec <= 600) return { label: 'Avg', className: '' };
  return { label: 'Slow', className: 'warn' };
}

function applyRowGlow() {
  if (!TBL.tbody) return;
  const rows = Array.from(TBL.tbody.querySelectorAll('tr'));
  rows.forEach(r => {
    r.classList.add('rowglow');
    r.classList.add('on');
  });
  setTimeout(() => {
    rows.forEach(r => r.classList.remove('on'));
  }, 600);
}

// ----- API -----
async function fetchAll() {
  showStatus('Loading…', 'loading');

  try {
    const [snapshotRes, historyRes] = await Promise.all([
      fetch('/api/snapshot'),
      fetch('/api/history?limit=100').catch(() => null),
    ]);

    if (!snapshotRes.ok) {
      throw new Error(`snapshot ${snapshotRes.status}`);
    }

    const snapshotJson = await snapshotRes.json();
    const historyJson = historyRes && historyRes.ok ? await historyRes.json() : null;

    STATE.snapshot = snapshotJson.chains || {};
    STATE.history = historyJson && historyJson.chains ? historyJson.chains : {};

    const serverTime = snapshotJson.generatedAt || new Date().toISOString();
    STATE.lastUpdated = serverTime;

    render();
    renderHistory();

    applyRowGlow();
    showStatus(`Updated ${fmtTime(serverTime)}`);
  } catch (err) {
    console.error(err);
    showStatus('Failed to fetch data', 'error');
  }
}

// ----- Rendering -----
function applyFilterAndSort() {
  const q = STATE.search.trim().toLowerCase();
  const priority = STATE.priority;

  let list = CHAINS.slice();

  if (q) {
    list = list.filter(c => {
      const t = `${c.name} ${c.ticker}`.toLowerCase();
      return t.includes(q);
    });
  }

  if (priority === 'fast') {
    // 速いチェーンを上に（単純に snapshot.speedSec でソート）
    list.sort((a, b) => {
      const sa = STATE.snapshot?.[a.id]?.speedSec ?? Infinity;
      const sb = STATE.snapshot?.[b.id]?.speedSec ?? Infinity;
      return sa - sb;
    });
  }

  return list;
}

function buildDetailsContent(data, fiat) {
  if (!data) return '';
  const tiers = Array.isArray(data.tiers) ? data.tiers : [];
  const tierMap = {
    fast: tiers.find(t => t.label === 'fast'),
    standard: tiers.find(t => t.label === 'standard'),
    slow: tiers.find(t => t.label === 'slow'),
  };

  const feeUsd = data.feeUSD;
  const feeJpy = data.feeJPY;
  const fastFee = tierMap.fast?.feeUSD ?? feeUsd;
  const standardFee = tierMap.standard?.feeUSD ?? feeUsd;
  const slowFee = tierMap.slow?.feeUSD ?? feeUsd;

  const fastJpy = tierMap.fast?.feeJPY ?? feeJpy;
  const standardJpy = tierMap.standard?.feeJPY ?? feeJpy;
  const slowJpy = tierMap.slow?.feeJPY ?? feeJpy;

  const fastSpeed = tierMap.fast?.speedSec ?? data.speedSec;
  const standardSpeed = tierMap.standard?.speedSec ?? data.speedSec;
  const slowSpeed = tierMap.slow?.speedSec ?? (standardSpeed != null ? standardSpeed * 2 : null);

  return `
    <div class="fee-details-block">
      <div class="mono strong">Exact fee: ${fmtFiat(feeUsd, feeJpy, fiat)}</div>
      <div class="gas-tiers-wrapper">
        <div class="mono">Fast (~${fmtTierSpeed(fastSpeed)}): ${fmtFiat(fastFee, fastJpy, fiat)}</div>
        <div class="mono">Normal (~${fmtTierSpeed(standardSpeed)}): ${fmtFiat(standardFee, standardJpy, fiat)}</div>
        <div class="mono">Slow (~${fmtTierSpeed(slowSpeed, true)}): ${fmtFiat(slowFee, slowJpy, fiat)}</div>
      </div>
    </div>
  `;
}

function render() {
  if (!TBL.tbody) return;

  const snapshot = STATE.snapshot || {};
  const rows = applyFilterAndSort();
  const fiat = STATE.fiat;

  const rowsHtml = rows.map(chain => {
    const data = snapshot[chain.id] || {};
    const fee = data.feeUSD;
    const feeCell = fee == null
      ? '<span class="mono">—</span>'
      : `<span class="mono">${fmtFiat(fee, data.feeJPY, fiat)}</span>`;

    const speedCell = data.speedSec == null
      ? '—'
      : `<span class="mono">${fmtSpeed(data.speedSec)}</span>`;

    const { label: statusLabel, className: statusClass } = decideStatusTag(data.speedSec, data.status);

    const statusHtml = `<span class="tag ${statusClass}">${statusLabel}</span>`;

    const updatedHtml = data.updated
      ? fmtTime(data.updated)
      : '—';

    const hasTiers = data.ok !== false && data.feeUSD != null && Array.isArray(data.tiers) && data.tiers.length > 0;

    const detailsCell = hasTiers
      ? `<button type="button" class="details-btn" data-chain-id="${chain.id}">Details</button>`
      : '<span class="muted">—</span>';

    let rowHtml = `
      <tr data-chain-id="${chain.id}">
        <td>${chain.name}</td>
        <td class="mono">${chain.ticker}</td>
        <td class="fee">${feeCell}</td>
        <td>${speedCell}</td>
        <td class="col-details">${detailsCell}</td>
        <td>${statusHtml}</td>
        <td class="updated">${updatedHtml}</td>
      </tr>
    `;

    if (STATE.openDetails === chain.id && hasTiers) {
      rowHtml += `
        <tr class="fee-details-row" data-details-for="${chain.id}">
          <td colspan="7" class="fee-details-cell">${buildDetailsContent(data, fiat)}</td>
        </tr>
      `;
    }

    return rowHtml;
  }).join('');

  TBL.tbody.innerHTML = rowsHtml;

  updateFeeHeader();
}

// フィアット切り替えヘッダ
function updateFeeHeader() {
  if (!TBL.feeHeader) return;
  const fiat = STATE.fiat;
  const label = fiat === 'JPY' ? 'Fee (JPY)' : 'Fee (USD)';
  TBL.feeHeader.textContent = label;
}

// ----- History chart -----
function renderHistory() {
  const canvas = TBL.historyCanvas;
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!canvas || !ctx) return;

  const chainId = TBL.historyChain ? TBL.historyChain.value : 'btc';
  const points = Array.isArray(STATE.history?.[chainId]) ? STATE.history[chainId] : [];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!points.length) {
    return;
  }

  // canvas サイズ
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 140;
  canvas.width = width;
  canvas.height = height;

  const xs = points.map(p => new Date(p.ts).getTime());
  const ys = points.map(p => p.feeUSD);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pad = 10;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  function toX(ts) {
    return pad + ((ts - minX) / rangeX) * (width - pad * 2);
  }
  function toY(v) {
    const ratio = (v - minY) / rangeY;
    return height - pad - ratio * (height - pad * 2);
  }

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#10B981';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = toX(new Date(p.ts).getTime());
    const y = toY(p.feeUSD);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ----- Event bindings -----
function bindUI() {
  if (TBL.q) {
    TBL.q.addEventListener('input', (e) => {
      STATE.search = e.target.value || '';
      render();
    });
  }

  if (TBL.priority) {
    TBL.priority.addEventListener('change', (e) => {
      STATE.priority = e.target.value || 'standard';
      render();
    });
  }

  if (TBL.fiat) {
    TBL.fiat.addEventListener('change', (e) => {
      STATE.fiat = e.target.value || 'USD';
      render();
    });
  }

  if (TBL.tbody) {
    TBL.tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.details-btn');
      if (!btn) return;
      const chainId = btn.dataset.chainId;
      const isOpen = STATE.openDetails === chainId;
      STATE.openDetails = isOpen ? null : chainId;
      render();
    });
  }

  if (REFRESH_BTN) {
    REFRESH_BTN.addEventListener('click', () => {
      fetchAll();
    });
  }

  if (THEME_BTN) {
    THEME_BTN.addEventListener('click', () => {
      const current = document.body.classList.contains('dark') ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  if (TBL.historyChain) {
    TBL.historyChain.addEventListener('change', () => {
      renderHistory();
    });
  }
}

// ----- Auto refresh -----
function startAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);
  AUTO_REFRESH_TIMER = setInterval(fetchAll, 60_000);
}

// ----- Init -----
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getInitialTheme());
  bindUI();
  fetchAll();
  startAutoRefresh();
});
