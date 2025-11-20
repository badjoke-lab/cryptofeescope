// ========== CryptoFeeScope — Phase2+3 (snapshot + tooltip + history + gas tiers toggle) ==========

// ----- Theme -----
(function initTheme () {
  const prefersDark =
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = localStorage.getItem('theme');
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const now =
        document.documentElement.getAttribute('data-theme') === 'dark'
          ? 'light'
          : 'dark';
      document.documentElement.setAttribute('data-theme', now);
      localStorage.setItem('theme', now);
    });
  }
})();

// ----- 定数 -----

const CHAINS = [
  { id: 'bitcoin',  chain: 'Bitcoin (L1)',         ticker: 'BTC' },
  { id: 'ethereum', chain: 'Ethereum (L1)',        ticker: 'ETH' },
  { id: 'arbitrum', chain: 'Arbitrum (L2 on ETH)', ticker: 'ARB' },
  { id: 'optimism', chain: 'Optimism (L2 on ETH)', ticker: 'OP'  },
  { id: 'solana',   chain: 'Solana (L1)',          ticker: 'SOL' },
  { id: 'polygon',  chain: 'Polygon (L2 / sidechain)', ticker: 'MATIC' },
  { id: 'bsc',      chain: 'BNB Smart Chain',      ticker: 'BNB' },
  { id: 'avalanche',chain: 'Avalanche C-Chain',    ticker: 'AVAX' },
  { id: 'tron',     chain: 'Tron',                 ticker: 'TRX' },
  { id: 'xrp',      chain: 'XRP Ledger',           ticker: 'XRP' },
  { id: 'litecoin', chain: 'Litecoin',             ticker: 'LTC' },
  { id: 'dogecoin', chain: 'Dogecoin',             ticker: 'DOGE' },
  { id: 'cardano',  chain: 'Cardano',              ticker: 'ADA' },
  { id: 'ton',      chain: 'TON',                  ticker: 'TON' },
  { id: 'base',     chain: 'Base (L2 on ETH)',     ticker: 'BASE' },
  { id: 'scroll',   chain: 'Scroll (L2 on ETH)',   ticker: 'SCR' },
  { id: 'zksync',   chain: 'zkSync Era',           ticker: 'ZKS' },
  { id: 'linea',    chain: 'Linea',                ticker: 'LINEA' },
  { id: 'mantle',   chain: 'Mantle',               ticker: 'MNT' },
  { id: 'sei',      chain: 'Sei',                  ticker: 'SEI' },
];

const FIAT_CONFIG = {
  USD: { label: 'USD', symbol: '$', rate: 1 },
  JPY: { label: 'JPY', symbol: '¥', rate: 150 },
};

// ----- 状態 -----

const STATE = {
  rows: [],
  lastError: null,
  timer: null,
  intervalMs: 60_000,
  fiat: 'USD',
  snapshot: null,
  history: [],
  historyChain: 'bitcoin',
};

// ----- DOM -----

const TBL = {
  tbody:           document.getElementById('tbody'),
  statusPill:      document.getElementById('statusPill'),
  prioritySelect:  document.getElementById('prioritySelect'),
  currencySelect:  document.getElementById('currencySelect'),
  searchInput:     document.getElementById('searchInput'),
  refreshBtn:      document.getElementById('refreshBtn'),
  updatedLabel:    document.getElementById('updatedLabel'),
  detailsTooltip:  document.getElementById('detailsTooltip'),
  historyCanvas:   document.getElementById('historyCanvas'),
  historySelect:   document.getElementById('historyChainSelect'),
};

const ERR_BANNER_ID = 'error-banner';

// ----- フィアット変換 -----

function fmtFiatFromUsd (feeUsd, fiatKey) {
  const cfg = FIAT_CONFIG[fiatKey] || FIAT_CONFIG.USD;
  if (feeUsd == null || !isFinite(feeUsd)) return '—';
  const converted = feeUsd * cfg.rate;
  if (converted === 0) return cfg.symbol + '0.0000';
  if (converted < 0.001) return cfg.symbol + converted.toFixed(4);
  if (converted < 1) return cfg.symbol + converted.toFixed(3);
  return cfg.symbol + converted.toFixed(2);
}

function fmtSpeed (sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.max(0, Number(sec) || 0);
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const min = s / 60;
  return `${min.toFixed(1)} min`;
}

function decideStatus (feeUsd, speedSec) {
  const fee = Number(feeUsd) || 0;
  const s   = Number(speedSec) || 0;
  if (fee < 0.05 && s < 5) return 'fast';
  if (fee > 0.5 || s > 15) return 'slow';
  return 'avg';
}

function nowTime () {
  const d  = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function setStatus (text) {
  if (TBL.statusPill) TBL.statusPill.textContent = text;
}

function showErrorBanner (msg) {
  if (!TBL.tbody) return;
  if (document.getElementById(ERR_BANNER_ID)) return;

  const card = TBL.tbody.closest('.card') || TBL.tbody.closest('article');
  if (!card) return;

  const banner = document.createElement('div');
  banner.id = ERR_BANNER_ID;
  banner.style.cssText =
    'background:rgba(239,68,68,.10);color:#b00;' +
    'border:1px solid rgba(239,68,68,.35);border-radius:10px;' +
    'padding:8px 12px;margin:0 14px 10px;';
  banner.textContent = msg || 'Failed to fetch data. Retrying in 30s…';

  const inner = card.querySelector('.inner') || card;
  inner.prepend(banner);

  setTimeout(() => {
    const el = document.getElementById(ERR_BANNER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }, 30_000);
}

// ----- Snapshot 取得 -----

async function fetchAll () {
  const res = await fetch('/api/snapshot');
  if (!res.ok) throw new Error('Failed to fetch /api/snapshot');
  const snapshot = await res.json();
  STATE.snapshot = snapshot;

  const rows = CHAINS.map(meta => {
    const snap = snapshot[meta.id];
    if (!snap) {
      return {
        id: meta.id,
        chain: meta.chain,
        ticker: meta.ticker,
        feeUSD: null,
        speedSec: null,
        status: 'avg',
        updated: '—',
      };
    }

    const feeUSD =
      snap.feeUSD == null || snap.feeUSD === ''
        ? null
        : Number(snap.feeUSD);

    const speedSec =
      snap.speedSec == null || snap.speedSec === ''
        ? null
        : Number(snap.speedSec);

    const status   = snap.status || decideStatus(feeUSD, speedSec);

    let updatedLabel = '—';
    if (snap.updated) {
      const d = new Date(snap.updated);
      if (!isNaN(d.getTime())) updatedLabel = d.toLocaleTimeString();
    }

    return {
      id: meta.id,
      chain: meta.chain,
      ticker: meta.ticker,
      feeUSD,
      speedSec,
      status,
      updated: updatedLabel,
    };
  });

  return rows;
}

function getGasTiersForChain (chainId) {
  const snapshot = STATE.snapshot;
  if (!snapshot) return [];
  const snap = snapshot[chainId];
  if (!snap || !Array.isArray(snap.tiers)) return [];
  return snap.tiers;
}

// ----- Filter -----

function applyFilter () {
  if (!TBL.tbody) return;
  const q = (TBL.searchInput?.value || '').trim().toLowerCase();
  const prio = TBL.prioritySelect?.value || 'standard';

  const rows = STATE.rows
    .filter(row => {
      if (!q) return true;
      const hay =
        (row.chain || '') +
        ' ' +
        (row.ticker || '') +
        ' ' +
        (row.id || '');
      return hay.toLowerCase().includes(q);
    })
    .map(row => {
      return {
        ...row,
        _priority: prio,
      };
    });

  if (!rows.length) {
    TBL.tbody.innerHTML = `
      <tr>
        <td colspan="7" class="mono" style="color:var(--muted)">
          No chains matched your search.
        </td>
      </tr>`;
    return;
  }

  const cur = STATE.fiat;
  const snapshot = STATE.snapshot || {};

  TBL.tbody.innerHTML = rows
    .map(r => {
      const feeCell =
        r.feeUSD == null
          ? '<span class="mono">—</span>'
          : `<span
               class="fee-btn mono"
               data-fee-usd="${r.feeUSD}"
               data-chain-id="${r.id || ''}"
               style="cursor:pointer;"
             >${fmtFiatFromUsd(r.feeUSD, cur)}</span>`;

      const snap = snapshot[r.id];
      const hasTiers = !!(snap && Array.isArray(snap.tiers) && snap.tiers.length);

      const detailsCell = hasTiers
        ? `<button
               class="details-btn"
               data-chain-id="${r.id || ''}"
               style="font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--border);background:var(--surface);cursor:pointer;"
           >▼ Details</button>`
        : '<span style="color:var(--muted);font-size:12px;">—</span>';

      const statusLabel =
        r.status === 'fast'
          ? 'Fast'
          : r.status === 'slow'
          ? 'Slow'
          : 'Avg';

      return `
        <tr data-chain-id="${r.id}">
          <td>${r.chain}</td>
          <td><span class="mono">${r.ticker}</span></td>
          <td>${feeCell}</td>
          <td><span class="mono">${fmtSpeed(r.speedSec)}</span></td>
          <td>
            <span class="pill pill-${r.status || 'avg'}">${statusLabel}</span>
          </td>
          <td><span class="mono">${r.updated}</span></td>
        </tr>`;
    })
    .join('');

  attachFeeTooltipHandlers();
  attachDetailsHandlers();
}

// ----- Tooltip (Exact fee) -----

function attachFeeTooltipHandlers () {
  const tooltip = TBL.detailsTooltip;
  if (!tooltip) return;

  tooltip.style.display = 'none';

  const feeBtns = document.querySelectorAll('.fee-btn');
  feeBtns.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const feeUsd = Number(btn.getAttribute('data-fee-usd'));
      const chainId = btn.getAttribute('data-chain-id') || '';
      const snap = STATE.snapshot && STATE.snapshot[chainId];
      const tiers = snap && Array.isArray(snap.tiers) ? snap.tiers : [];

      let html = `<div class="mono" style="font-size:12px;">Exact fee (USD): ${feeUsd.toFixed(6)}</div>`;
      if (tiers.length) {
        html += '<div style="margin-top:4px;font-size:11px;">';
        tiers.forEach(t => {
          html += `<div>${t.label || t.tier}: ${t.feeUSD != null ? t.feeUSD.toFixed(6) : '—'} USD</div>`;
        });
        html += '</div>';
      }

      tooltip.innerHTML = html;

      const rect = btn.getBoundingClientRect();
      tooltip.style.left = rect.left + 'px';
      tooltip.style.top = rect.bottom + 4 + 'px';
      tooltip.style.display = 'block';
    });

    btn.addEventListener('mouseleave', () => {
      if (TBL.detailsTooltip) {
        TBL.detailsTooltip.style.display = 'none';
      }
    });
  });
}

// ----- ガスティア詳細行 -----

function toggleGasDetailsRow (rowEl, chainId, btnEl) {
  const existing = rowEl.nextElementSibling;
  if (existing && existing.classList.contains('gas-details-row')) {
    existing.parentNode.removeChild(existing);
    if (btnEl) btnEl.textContent = '▼ Details';
    return;
  }

  const tiers = getGasTiersForChain(chainId);
  if (!tiers.length) return;

  const colSpan = rowEl.children.length;
  const tr = document.createElement('tr');
  tr.className = 'gas-details-row';
  tr.innerHTML = `
    <td colspan="${colSpan}">
      <div class="mono" style="font-size:12px;color:var(--muted);padding:4px 8px;">
        ${tiers
          .map(t => {
            const fee =
              t.feeUSD == null
                ? '—'
                : `${t.feeUSD.toFixed(6)} USD`;
            const speed =
              t.speedMinSec && t.speedMaxSec && t.speedMinSec !== t.speedMaxSec
                ? `${fmtSpeed(t.speedMinSec)}–${fmtSpeed(t.speedMaxSec)}`
                : fmtSpeed(t.speedMinSec || t.speedMaxSec);
            return `${t.label || t.tier}: ${fee} / ${speed}`;
          })
          .join(' | ')}
      </div>
    </td>`;
  rowEl.parentNode.insertBefore(tr, rowEl.nextSibling);
  if (btnEl) btnEl.textContent = '▲ Details';
}

function attachDetailsHandlers () {
  const btns = document.querySelectorAll('.details-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const row = btn.closest('tr');
      if (!row) return;

      const chainId = btn.getAttribute('data-chain-id') || row.getAttribute('data-chain-id') || '';
      if (!chainId) return;

      toggleGasDetailsRow(row, chainId, btn);
    });
  });
}

// ----- 履歴取得 -----

async function fetchHistory () {
  if (!TBL.historyCanvas) return;

  const url = `/api/history?limit=100&chain=${encodeURIComponent(
    STATE.historyChain
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch /api/history');
  const data = await res.json();
  STATE.history = Array.isArray(data) ? data : [];
  drawHistory();
}

function drawHistory () {
  const canvas = TBL.historyCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const rows = STATE.history;
  if (!rows.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px system-ui';
    ctx.fillStyle = '#999';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No history yet', canvas.width / 2, canvas.height / 2);
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  const paddingX = 24;
  const paddingY = 12;
  const innerW = w - paddingX * 2;
  const innerH = h - paddingY * 2;

  const fees = rows.map(r => Number(r.feeUSD) || 0);
  const minFee = Math.min(...fees);
  const maxFee = Math.max(...fees);
  const span = maxFee - minFee || 1;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--surface-alt') || '#f9fafb';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paddingX, paddingY + innerH / 2);
  ctx.lineTo(paddingX + innerW, paddingY + innerH / 2);
  ctx.stroke();

  const n = rows.length;
  const dx = n > 1 ? innerW / (n - 1) : 0;

  ctx.beginPath();
  rows.forEach((row, i) => {
    const x = paddingX + dx * i;
    const y =
      paddingY +
      innerH -
      ((Number(row.feeUSD) || 0) - minFee) * (innerH / span);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ----- イベント -----

function setupEventHandlers () {
  if (TBL.currencySelect) {
    TBL.currencySelect.addEventListener('change', () => {
      STATE.fiat = TBL.currencySelect.value || 'USD';
      applyFilter();
    });
  }

  if (TBL.searchInput) {
    TBL.searchInput.addEventListener('input', () => {
      applyFilter();
    });
  }

  if (TBL.prioritySelect) {
    TBL.prioritySelect.addEventListener('change', () => {
      applyFilter();
    });
  }

  if (TBL.refreshBtn) {
    TBL.refreshBtn.addEventListener('click', () => {
      refreshOnce({ showGlow: true }).catch(() => {});
    });
  }

  if (TBL.historySelect) {
    TBL.historySelect.addEventListener('change', () => {
      STATE.historyChain = TBL.historySelect.value || 'bitcoin';
      fetchHistory().catch(() => {});
    });
  }
}

// ----- 行ハイライト -----

function glowRows () {
  const rows = TBL.tbody ? TBL.tbody.querySelectorAll('tr') : [];
  rows.forEach(row => {
    row.classList.add('glow-once');
    setTimeout(() => row.classList.remove('glow-once'), 600);
  });
}

// ----- リフレッシュ -----

async function refreshOnce ({ showGlow = true } = {}) {
  try {
    if (TBL.refreshBtn) TBL.refreshBtn.disabled = true;

    const rows = await fetchAll();
    STATE.rows = rows;
    applyFilter();

    fetchHistory().catch(() => {});

    setStatus('Updated ' + nowTime());
    if (showGlow) glowRows();
  } catch (err) {
    console.error(err);
    STATE.lastError = err;
    showErrorBanner('Failed to fetch data. Retrying in 30s…');
  } finally {
    if (TBL.refreshBtn) TBL.refreshBtn.disabled = false;
  }
}

// ----- Boot -----

(function boot () {
  setStatus('Updated —');
  setupEventHandlers();
  refreshOnce({ showGlow: false });
  clearInterval(STATE.timer);
  STATE.timer = setInterval(
    () => refreshOnce({ showGlow: true }),
    STATE.intervalMs
  );
})();
