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
  { id: 'solana',   chain: 'Solana',               ticker: 'SOL' },
];

// feeFormat.js と同じ概念。label/rate だけ渡す。
const FIAT_CONFIG = {
  USD: { label: 'USD', symbol: '$', rate: 1 },
  JPY: { label: 'JPY', symbol: '¥', rate: 150 }, // ダミーレート
};

// ----- 状態 -----

const STATE = {
  rows: [],                // テーブル表示用の行（最新スナップショット）
  lastError: null,
  timer: null,
  intervalMs: 60_000,      // 60s ごとに自動更新
  fiat: 'USD',             // 選択中フィアット
  snapshot: null,          // /api/snapshot の生データ（tier 表示に使う）
  history: [],             // /api/history の配列（生データ）
  historyChain: 'bitcoin', // プレビュー対象チェーン
};

// ----- DOM -----

const TBL = {
  tbody:           document.getElementById('tbody'),
  statusPill:      document.getElementById('status'),
  refreshBtn:      document.getElementById('refreshBtn'),
  searchInput:     document.getElementById('q'),
  prioritySel:     document.getElementById('priority'),
  fiatSel:         document.getElementById('fiat'),
  feeHeader:       document.getElementById('feeHeader'),
  historyCanvas:   document.getElementById('historyCanvas'),
  historyChainSel: document.getElementById('historyChain'),
};

const ERR_BANNER_ID = 'err-banner';

// ----- ユーティリティ -----

// feeFormat.js に formatFeeDisplay / buildFeeTooltipInfo があればそれを使う。
// なければフォールバックで自前表示。
function fmtFiatFromUsd (usd, fiatCode) {
  const cfg = FIAT_CONFIG[fiatCode] || FIAT_CONFIG.USD;
  const v = Number(usd) || 0;

  if (typeof formatFeeDisplay === 'function') {
    return formatFeeDisplay(v, cfg.label, cfg.rate);
  }

  const converted = v * cfg.rate;
  if (converted === 0) return cfg.symbol + '0';
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

// USDベースの簡易ステータス
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
    banner.remove();
  }, 5000);
}

// ----- /api/snapshot → rows 変換 -----

async function fetchAll () {
  const res = await fetch('/api/snapshot');
  if (!res.ok) {
    throw new Error('Failed to fetch /api/snapshot');
  }
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

    const feeUSD   = Number(snap.feeUSD)   || 0;
    const speedSec = Number(snap.speedSec) || 0;
    const status   = snap.status || decideStatus(feeUSD, speedSec);

    let updatedLabel = '—';
    if (snap.updated) {
      const d = new Date(snap.updated);
      if (!isNaN(d.getTime())) {
        updatedLabel = d.toLocaleTimeString();
      }
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

// ----- Gas tier 取得ヘルパー -----

function getGasTiersForChain (chainId) {
  const snapshot = STATE.snapshot;
  if (!snapshot) return [];
  const snap = snapshot[chainId];
  if (!snap || !Array.isArray(snap.tiers)) return [];
  return snap.tiers;
}

// ----- テーブル描画 -----

function renderTag (status) {
  const map  = { fast: 'good', avg: 'warn', slow: 'bad' };
  const cls  = map[status] || 'warn';
  const text = status === 'fast' ? 'Fast' : status === 'slow' ? 'Slow' : 'Avg';
  return `<span class="tag ${cls}">${text}</span>`;
}

function render (rows) {
  if (!TBL.tbody) return;

  // ヘッダの通貨表示
  if (TBL.feeHeader) {
    const cfg = FIAT_CONFIG[STATE.fiat] || FIAT_CONFIG.USD;
    TBL.feeHeader.textContent = `Fee (${cfg.label})`;
  }

  if (!rows || !rows.length) {
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

      // tier があるチェーンだけ ▾ ボタンを出す
      const snap = snapshot[r.id];
      const hasTiers = !!(snap && Array.isArray(snap.tiers) && snap.tiers.length);

      const detailsCell = hasTiers
        ? `<button
             type="button"
             class="fee-details-toggle"
             data-chain-id="${r.id || ''}"
             aria-label="Toggle gas tiers"
           >▾</button>`
        : '';

      return `
        <tr class="rowglow" data-chain-id="${r.id || ''}">
          <td>${r.chain}</td>
          <td class="mono">${r.ticker}</td>
          <td class="fee">${feeCell}</td>
          <td class="mono">${r.speedSec == null ? '—' : fmtSpeed(r.speedSec)}</td>
          <td class="col-details">${detailsCell}</td>
          <td>${renderTag(r.status)}</td>
          <td class="updated">${r.updated || '—'}</td>
        </tr>
      `;
    })
    .join('');
}

function glowRows () {
  if (!TBL.tbody) return;
  Array.prototype.forEach.call(
    TBL.tbody.querySelectorAll('tr'),
    tr => {
      tr.classList.remove('on');
      void tr.offsetWidth; // reflow
      tr.classList.add('on');
      setTimeout(() => tr.classList.remove('on'), 600);
    }
  );
}

// ----- Gas tier 展開行の追加 / 削除 -----

function createGasDetailsRow (chainId) {
  const tiers = getGasTiersForChain(chainId);
  const tr = document.createElement('tr');
  tr.className = 'fee-details-row';

  const td = document.createElement('td');
  td.colSpan = 7;
  td.className = 'fee-details-cell';

  if (!tiers.length) {
    td.textContent = 'No gas tier information available for this chain.';
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'gas-tiers-wrapper';

    const title = document.createElement('div');
    title.className = 'gas-tiers-title';
    title.textContent = 'Gas tiers';
    wrapper.appendChild(title);

    tiers.forEach((tier) => {
      // 想定: tier = { tier, gasPrice, gasUnit, feeUSD, speedMinSec, speedMaxSec }
      const line = document.createElement('div');
      line.className = 'gas-tier-line';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'gas-tier-label';
      labelSpan.textContent = tier.tier || '';

      const gasSpan = document.createElement('span');
      gasSpan.className = 'gas-tier-gas';
      if (tier.gasPrice != null) {
        const unit = tier.gasUnit || 'gwei';
        gasSpan.textContent = `${tier.gasPrice} ${unit}`;
      }

      const feeSpan = document.createElement('span');
      feeSpan.className = 'gas-tier-fee';
      if (tier.feeUSD != null) {
        feeSpan.textContent = fmtFiatFromUsd(tier.feeUSD, STATE.fiat);
      }

      const speedSpan = document.createElement('span');
      speedSpan.className = 'gas-tier-speed';
      if (tier.speedMinSec != null && tier.speedMaxSec != null) {
        speedSpan.textContent =
          `${tier.speedMinSec.toFixed(0)}–${tier.speedMaxSec.toFixed(0)} s`;
      }

      line.appendChild(labelSpan);
      if (gasSpan.textContent) line.appendChild(gasSpan);
      if (feeSpan.textContent) line.appendChild(feeSpan);
      if (speedSpan.textContent) line.appendChild(speedSpan);

      wrapper.appendChild(line);
    });

    td.appendChild(wrapper);
  }

  tr.appendChild(td);
  return tr;
}

function toggleGasDetailsRow (baseRow, chainId, toggleBtn) {
  const tbody = baseRow.parentElement;
  if (!tbody) return;

  const next = baseRow.nextElementSibling;

  // すでに詳細行が付いている場合 → 閉じる
  if (next && next.classList.contains('fee-details-row')) {
    next.remove();
    if (toggleBtn) toggleBtn.textContent = '▾';
    return;
  }

  // 新しく詳細行を追加
  const detailsTr = createGasDetailsRow(chainId);
  tbody.insertBefore(detailsTr, baseRow.nextSibling);
  if (toggleBtn) toggleBtn.textContent = '▴';
}

// ----- 検索フィルタ -----

function applyFilter () {
  const q = (TBL.searchInput && TBL.searchInput.value || '').trim().toLowerCase();
  let rows = STATE.rows.slice();

  if (q) {
    rows = rows.filter(r => {
      return (
        (r.chain   && r.chain.toLowerCase().includes(q)) ||
        (r.ticker  && r.ticker.toLowerCase().includes(q))
      );
    });
  }

  render(rows);
}

// ----- 履歴取得 & 描画 -----

async function fetchHistory () {
  try {
    // 直近 100 件だけ取得
    const res = await fetch('/api/history?limit=100');
    if (!res.ok) throw new Error('Failed to fetch /api/history');
    const json = await res.json();
    // 期待フォーマット: [{ ts, bitcoin:{feeUSD...}, ethereum:{...} , ... }, ...]
    if (!Array.isArray(json)) return;
    STATE.history = json;
    renderHistoryChart();
  } catch (err) {
    console.error(err);
  }
}

function renderHistoryChart () {
  const canvas = TBL.historyCanvas;
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const history = STATE.history;
  const chainId = STATE.historyChain;

  const width  =
    canvas.clientWidth ||
    (canvas.parentElement && canvas.parentElement.clientWidth) ||
    640;
  const height = canvas.clientHeight || 140;
  canvas.width  = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);

  if (!Array.isArray(history) || !history.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('No history yet. Refresh a few times.', 12, 24);
    return;
  }

  const fiatCfg = FIAT_CONFIG[STATE.fiat] || FIAT_CONFIG.USD;

  // ts 昇順で並べる & 直近 maxPoints 件に絞る
  const sorted = history
    .slice()
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const maxPoints = 100;
  const sliced = sorted.slice(Math.max(0, sorted.length - maxPoints));

  const rows = sliced.map(entry => {
    const snap = entry[chainId];
    const feeUsd = snap ? Number(snap.feeUSD) || 0 : 0;
    const feeFiat = feeUsd * fiatCfg.rate;  // フィアット換算
    const ts   = entry.ts || Date.now();
    return { ts, v: feeFiat };
  });

  if (!rows.length) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText('No data for this chain.', 12, 24);
    return;
  }

  // すべてほぼ同じ値かどうか
  const base = rows[0].v;
  const isFlat = rows.every(r => Math.abs(r.v - base) < 1e-9);

  let min = rows.reduce((m, r) => Math.min(m, r.v), rows[0].v);
  let max = rows.reduce((m, r) => Math.max(m, r.v), rows[0].v);
  if (min === max) {
    const delta = min === 0 ? 1 : Math.abs(min) * 0.2;
    min -= delta;
    max += delta;
  }

  const paddingX = 8;
  const paddingY = 8;
  const innerW = Math.max(1, width  - paddingX * 2);
  const innerH = Math.max(1, height - paddingY * 2);

  // 背景メッセージ（フラットな場合の注意書き）
  if (isFlat) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText('Note: fees are almost flat in this range.', 12, 20);
  }

  // グリッドの薄いライン（Y 中央）
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paddingX, paddingY + innerH / 2);
  ctx.lineTo(paddingX + innerW, paddingY + innerH / 2);
  ctx.stroke();

  // 実線
  const n = rows.length;
  const dx = n > 1 ? innerW / (n - 1) : 0;

  ctx.beginPath();
  rows.forEach((row, i) => {
    const x = paddingX + dx * i;
    const yRatio = (row.v - min) / (max - min || 1);
    const y = paddingY + innerH - innerH * yRatio;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#111827';
  ctx.stroke();
}

// ----- fee ツールチップ（正確な値のみ）-----

function closeAllTooltips () {
  document.querySelectorAll('.fee-tooltip').forEach(el => el.remove());
  document.removeEventListener('click', handleTooltipOutsideClick);
}

function handleTooltipOutsideClick (e) {
  const tooltip = e.target.closest('.fee-tooltip');
  const btn = e.target.closest('.fee-btn');
  if (!tooltip && !btn) {
    closeAllTooltips();
  }
}

function setupFeeTooltipHandler () {
  if (!TBL.tbody) return;

  TBL.tbody.addEventListener('click', e => {
    const btn = e.target.closest('.fee-btn');
    if (!btn) {
      // セル以外クリックで閉じる（Details ボタンなどは別ハンドラ）
      if (!e.target.closest('.fee-details-toggle')) {
        closeAllTooltips();
      }
      return;
    }

    e.stopPropagation();
    closeAllTooltips();

    const feeUsd  = parseFloat(btn.getAttribute('data-fee-usd') || '0');
    const chainId = btn.getAttribute('data-chain-id') || '';
    const cfg = FIAT_CONFIG[STATE.fiat] || FIAT_CONFIG.USD;

    let tooltipInfo = null;
    if (typeof buildFeeTooltipInfo === 'function') {
      // exact だけ利用。tier / zero-count はここでは表示しない。
      tooltipInfo = buildFeeTooltipInfo(feeUsd, cfg.label, cfg.rate);
    } else {
      const exact = fmtFiatFromUsd(feeUsd, STATE.fiat) + ' ' + cfg.label;
      tooltipInfo = { exactLabel: exact };
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'fee-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.zIndex = '9999';

    // ★ ポップアップは常にライトグレー固定
    tooltip.style.background   = '#f3f4f6';
    tooltip.style.color        = '#111827';
    tooltip.style.border       = '1px solid #d1d5db';
    tooltip.style.borderRadius = '8px';
    tooltip.style.padding      = '8px 10px';
    tooltip.style.fontSize     = '12px';
    tooltip.style.boxShadow    = '0 8px 24px rgba(15,23,42,.12)';
    tooltip.style.maxWidth     = '260px';

    const exactHtml = `
      <div class="cfs-tooltip-title" style="font-weight:600;margin-bottom:2px;">Exact fee</div>
      <div class="cfs-tooltip-line mono" style="margin-bottom:4px;">${tooltipInfo.exactLabel}</div>
    `;

    // ★ Gas tier 情報はここでは出さない（Details トグルで見る）
    tooltip.innerHTML = exactHtml;
    document.body.appendChild(tooltip);

    const rect = btn.getBoundingClientRect();
    const top  = window.scrollY + rect.bottom + 6;
    const left = window.scrollX + rect.left + rect.width / 2;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.transform = 'translateX(-50%)';

    document.addEventListener('click', handleTooltipOutsideClick);
  });
}

// ----- Gas details トグルハンドラ -----

function setupDetailsToggleHandler () {
  if (!TBL.tbody) return;

  TBL.tbody.addEventListener('click', e => {
    const btn = e.target.closest('.fee-details-toggle');
    if (!btn) return;

    e.stopPropagation();
    const row = btn.closest('tr');
    if (!row) return;

    const chainId = btn.getAttribute('data-chain-id') || row.getAttribute('data-chain-id') || '';
    if (!chainId) return;

    toggleGasDetailsRow(row, chainId, btn);
  });
}

// ----- リフレッシュ -----

async function refreshOnce ({ showGlow = true } = {}) {
  try {
    if (TBL.refreshBtn) TBL.refreshBtn.disabled = true;

    const rows = await fetchAll();
    STATE.rows = rows;
    applyFilter();

    // 履歴も更新（グラフ用）
    fetchHistory().catch(() => {});

    setStatus('Updated ' + nowTime());
    if (showGlow) glowRows();
  } catch (err) {
    console.error(err);
    STATE.lastError = err;
    showErrorBanner('Failed to fetch data. Retrying in 30s…');
    setStatus('Update failed ' + nowTime());
    setTimeout(() => refreshOnce({ showGlow: false }), 30_000);
  } finally {
    if (TBL.refreshBtn) TBL.refreshBtn.disabled = false;
  }
}

// ----- イベント束ね -----

function setupEventHandlers () {
  if (TBL.refreshBtn) {
    TBL.refreshBtn.addEventListener('click', () =>
      refreshOnce({ showGlow: true })
    );
  }

  if (TBL.searchInput) {
    let t = null;
    TBL.searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(applyFilter, 180); // debounce
    });
  }

  if (TBL.prioritySel) {
    // まだダミー
    TBL.prioritySel.addEventListener('change', () => {});
  }

  if (TBL.fiatSel) {
    TBL.fiatSel.addEventListener('change', e => {
      const val = e.target.value || 'USD';
      STATE.fiat = FIAT_CONFIG[val] ? val : 'USD';
      applyFilter();        // 再描画
      renderHistoryChart(); // 履歴グラフも更新
    });
  }

  if (TBL.historyChainSel) {
    TBL.historyChainSel.addEventListener('change', e => {
      const val = e.target.value || 'bitcoin';
      STATE.historyChain = val;
      renderHistoryChart();
    });
  }

  setupFeeTooltipHandler();
  setupDetailsToggleHandler();
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
