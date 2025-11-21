// ========== CryptoFeeScope — snapshot + history + fee details tooltip ==========

// ----- Theme -----
const THEME_KEY = 'cfs-theme';

function getInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

// 初期テーマ適用
applyTheme(getInitialTheme());

// ----- DOM refs -----
const TBL = {
  status: document.getElementById('statusText'),
  updated: document.getElementById('updatedText'),
  q: document.getElementById('searchInput'),
  priority: document.getElementById('prioritySelect'),
  fiat: document.getElementById('fiatSelect'),
  tbody: document.getElementById('mainTbody'),
  historyCard: document.getElementById('historyCard'),
  historyTitle: document.getElementById('historyTitle'),
  historyEmpty: document.getElementById('historyEmpty'),
  historyCanvas: document.getElementById('historyCanvas'),
  historyChain: document.getElementById('historyChainSelect'),
  feeHeader: document.getElementById('feeHeader'),
};

const DETAILS_TOOLTIP = document.getElementById('detailsTooltip');

// ----- Config -----
const FIAT_CONFIG = {
  USD: { symbol: '$', key: 'usd' },
  JPY: { symbol: '¥', key: 'jpy' },
};

// チェーン定義（表示順）
const CHAINS = [
  { id: 'btc', name: 'Bitcoin (L1)', ticker: 'BTC', family: 'bitcoin' },
  { id: 'eth', name: 'Ethereum (L1)', ticker: 'ETH', family: 'evm' },
  { id: 'arb', name: 'Arbitrum (L2 on ETH)', ticker: 'ARB', family: 'evm' },
  { id: 'op',  name: 'Optimism (L2 on ETH)', ticker: 'OP',  family: 'evm' },
  { id: 'sol', name: 'Solana (L1)', ticker: 'SOL', family: 'solana' },
  { id: 'matic', name: 'Polygon (L2 / sidechain)', ticker: 'MATIC', family: 'evm' },
  { id: 'bnb', name: 'BNB Smart Chain', ticker: 'BNB', family: 'evm' },
  { id: 'avax', name: 'Avalanche C-Chain', ticker: 'AVAX', family: 'evm' },
  { id: 'trx', name: 'Tron', ticker: 'TRX', family: 'tron' },
  { id: 'xrp', name: 'XRP Ledger', ticker: 'XRP', family: 'xrp' },
  { id: 'ltc', name: 'Litecoin', ticker: 'LTC', family: 'utxo' },
  { id: 'doge', name: 'Dogecoin', ticker: 'DOGE', family: 'utxo' },
  { id: 'ada', name: 'Cardano', ticker: 'ADA', family: 'cardano' },
  { id: 'ton', name: 'TON', ticker: 'TON', family: 'ton' },
  { id: 'base', name: 'Base (L2 on ETH)', ticker: 'BASE', family: 'evm' },
  { id: 'scr', name: 'Scroll (L2 on ETH)', ticker: 'SCR', family: 'evm' },
  { id: 'zks', name: 'zkSync Era', ticker: 'ZKS', family: 'evm' },
  { id: 'linea', name: 'Linea', ticker: 'LINEA', family: 'evm' },
  { id: 'mnt', name: 'Mantle', ticker: 'MNT', family: 'evm' },
  { id: 'sei', name: 'Sei', ticker: 'SEI', family: 'sei' }
];

const STATE = {
  snapshot: null,      // { [id]: { feeUsd, feeJpy, speedSec, status, updatedAt, tiers, ... } }
  history: [],         // [{ chainId, ts, feeUsd }]
  fiat: 'USD',
  priority: 'standard',
  search: '',
  lastUpdated: null,
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

function fmtFiatFromUsd(feeUsd, fiat) {
  if (feeUsd == null || !Number.isFinite(feeUsd)) return '—';
  const cfg = FIAT_CONFIG[fiat] || FIAT_CONFIG.USD;
  if (fiat === 'USD') {
    if (feeUsd < 0.001) return '< $0.001';
    return `${cfg.symbol}${feeUsd.toFixed(3)}`;
  }
  // JPY 想定：snapshot 側ですでに fiat 変換済みならその値を使う
  const value = feeUsd;
  return `${cfg.symbol}${value.toFixed(2)}`;
}

function decideStatusTag(sec) {
  if (sec == null || !Number.isFinite(sec)) return { label: 'Avg', className: '' };
  if (sec <= 60) return { label: 'Fast', className: 'good' };
  if (sec <= 600) return { label: 'Avg', className: '' };
  return { label: 'Slow', className: 'warn' };
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
    STATE.history = historyJson && Array.isArray(historyJson.points)
      ? historyJson.points
      : [];

    const serverTime = snapshotJson.generatedAt || new Date().toISOString();
    STATE.lastUpdated = serverTime;

    render();
    renderHistory();

    showStatus('OK');
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

function render() {
  if (!TBL.tbody) return;

  const snapshot = STATE.snapshot || {};
  const rows = applyFilterAndSort();
  const fiat = STATE.fiat;

  const rowsHtml = rows.map(chain => {
    const data = snapshot[chain.id] || {};
    const fee = data.feeUsd;
    const feeCell = fee == null
      ? '<span class="mono">—</span>'
      : `<span class="mono">${fmtFiatFromUsd(fee, fiat)}</span>`;

    const speedCell = data.speedSec == null
      ? '—'
      : `<span class="mono">${fmtSpeed(data.speedSec)}</span>`;

    const { label: statusLabel, className: statusClass } = decideStatusTag(data.speedSec);

    const statusHtml = `<span class="tag ${statusClass}">${statusLabel}</span>`;

    const updatedHtml = data.updatedAt
      ? fmtTime(data.updatedAt)
      : '—';

    const hasTiers = Array.isArray(data.tiers) && data.tiers.length > 0;

    const detailsCell = hasTiers
      ? `<button type="button" class="details-btn" data-chain-id="${chain.id}">Details</button>`
      : '<span class="muted">—</span>';

    return `
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
  }).join('');

  TBL.tbody.innerHTML = rowsHtml;

  if (TBL.updated) {
    TBL.updated.textContent = STATE.lastUpdated
      ? fmtTime(STATE.lastUpdated)
      : '—';
  }

  updateFeeHeader();
  attachDetailsTooltipHandlers();
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
  const points = STATE.history.filter(p => p.chainId === chainId);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!points.length) {
    if (TBL.historyEmpty) {
      TBL.historyEmpty.classList.remove('hidden');
    }
    return;
  }
  if (TBL.historyEmpty) {
    TBL.historyEmpty.classList.add('hidden');
  }

  // canvas サイズ
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 140;
  canvas.width = width;
  canvas.height = height;

  const xs = points.map(p => p.ts);
  const ys = points.map(p => p.feeUsd);

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
    const x = toX(p.ts);
    const y = toY(p.feeUsd);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ----- Details tooltip (Exact fee + tiers) -----
let DETAILS_TOOLTIP_BOUND = false;

function attachDetailsTooltipHandlers() {
  if (DETAILS_TOOLTIP_BOUND || !TBL.tbody || !DETAILS_TOOLTIP) return;
  DETAILS_TOOLTIP_BOUND = true;

  // テーブル内クリック
  TBL.tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.details-btn');
    if (!btn) return;

    const chainId = btn.dataset.chainId;
    const data = STATE.snapshot && STATE.snapshot[chainId];
    if (!data) return;

    const fiat = STATE.fiat;
    const feeUsd = data.feeUsd;
    if (feeUsd == null || !Number.isFinite(feeUsd)) return;

    const tiers = Array.isArray(data.tiers) ? data.tiers : [];

    let html = '';
    html += `<div class="mono strong">Exact fee: ${fmtFiatFromUsd(feeUsd, fiat)}</div>`;

    tiers.forEach(t => {
      const tierFee = t.feeUsd != null ? t.feeUsd : feeUsd;
      html += `<div class="mono">${t.label || t.name || ''}: ${fmtFiatFromUsd(tierFee, fiat)}</div>`;
    });

    DETAILS_TOOLTIP.innerHTML = html;

    // 位置調整：Details ボタンのすぐ下
    const rect = btn.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;

    DETAILS_TOOLTIP.style.position = 'absolute';
    DETAILS_TOOLTIP.style.left = `${rect.left + scrollX}px`;
    DETAILS_TOOLTIP.style.top = `${rect.bottom + 8 + scrollY}px`;
    DETAILS_TOOLTIP.classList.remove('hidden');
  });

  // テーブル外クリックで閉じる
  document.addEventListener('click', (e) => {
    if (!DETAILS_TOOLTIP) return;
    if (e.target.closest('.details-btn') || e.target.closest('#detailsTooltip')) {
      return;
    }
    DETAILS_TOOLTIP.classList.add('hidden');
  });
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

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchAll();
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
  bindUI();
  fetchAll();
  startAutoRefresh();
});
