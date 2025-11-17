// ========== CryptoFeeScope — Phase2+3 logic (snapshot + tooltip + history) ==========

// ----- Theme -----
(function initTheme(){
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = localStorage.getItem('theme');
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn){
    themeBtn.addEventListener('click', () => {
      const now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', now);
      localStorage.setItem('theme', now);
    });
  }
})();

// ----- 定数 -----

const CHAINS = [
  { id: 'bitcoin',  chain: 'Bitcoin (L1)',              ticker: 'BTC' },
  { id: 'ethereum', chain: 'Ethereum (L1)',             ticker: 'ETH' },
  { id: 'arbitrum', chain: 'Arbitrum (L2 on ETH)',      ticker: 'ARB' },
  { id: 'optimism', chain: 'Optimism (L2 on ETH)',      ticker: 'OP'  },
  { id: 'solana',   chain: 'Solana',                    ticker: 'SOL' },
];

const FIAT_CONFIG = {
  USD: { label:'USD', symbol:'$', rate:1 },
  JPY: { label:'JPY', symbol:'¥', rate:150 }, // 将来API差し替え用のダミー
};

// ----- 状態 -----

const STATE = {
  rows: [],          // 表示用の行データ（最新スナップショットを反映）
  lastError: null,
  timer: null,
  intervalMs: 60_000, // 60 秒ごと自動更新
  fiat: 'USD',       // 現在選択中の通貨
  snapshot: null,    // /api/snapshot の生データ（tier 表示に利用）
  history: [],       // /api/history で取得した履歴
  historyChain: 'bitcoin', // グラフ表示対象チェーン
};

const TBL = {
  tbody: document.getElementById('tbody'),
  statusPill: document.getElementById('status'),
  refreshBtn: document.getElementById('refreshBtn'),
  searchInput: document.getElementById('q'),
  prioritySel: document.getElementById('priority'),
  fiatSel: document.getElementById('fiat'),
  feeHeader: document.getElementById('feeHeader'),
  historyCanvas: document.getElementById('historyCanvas'),
  historyChainSel: document.getElementById('historyChain'),
};

const ERR_BANNER = document.getElementById('err-banner');

// ----- ユーティリティ -----

function fmtFiatFromUsd(usd, fiatCode){
  const cfg = FIAT_CONFIG[fiatCode] || FIAT_CONFIG.USD;
  const v = usd * cfg.rate;
  if (v >= 1) return cfg.symbol + v.toFixed(2);
  if (v >= 0.01) return cfg.symbol + v.toFixed(3);
  // 0.01 未満は < $0.001 表記に統一
  return '< ' + cfg.symbol + '0.001';
}

function fmtSpeed(sec){
  if (!sec && sec !== 0) return '—';
  if (sec < 60) return sec.toFixed(0) + ' s';
  const min = sec / 60;
  return min.toFixed(1) + ' min';
}

function decideStatus(feeUsd, speedSec){
  if (!isFinite(feeUsd) || !isFinite(speedSec)) return 'avg';
  if (feeUsd <= 0.05 && speedSec <= 15) return 'fast';
  if (feeUsd >= 5 || speedSec >= 600) return 'slow';
  return 'avg';
}

function nowTime(){
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

function setStatus(text){
  if (TBL.statusPill){
    TBL.statusPill.textContent = text;
  }
}

function clearErrorBanner(){
  if (!ERR_BANNER) return;
  ERR_BANNER.classList.add('hidden');
  ERR_BANNER.textContent = '';
}

function showErrorBanner(msg){
  if (!ERR_BANNER) return;
  ERR_BANNER.textContent = msg;
  ERR_BANNER.classList.remove('hidden');
}

// ----- テーブル描画 -----

function renderRows(rows){
  if (!TBL.tbody) return;
  TBL.tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'cfs-row';

    const feeLabel = row.feeUSD == null
      ? '—'
      : fmtFiatFromUsd(row.feeUSD, STATE.fiat);

    const speedLabel = fmtSpeed(row.speedSec);

    const statusLabel = row.status === 'fast' ? 'Fast'
      : row.status === 'slow' ? 'Slow'
      : 'Avg';

    const statusClass = row.status === 'fast'
      ? 'pill pill-fast'
      : row.status === 'slow'
      ? 'pill pill-slow'
      : 'pill pill-avg';

    tr.innerHTML = `
      <td class="cell chain">${row.chain}</td>
      <td class="cell ticker mono">${row.ticker}</td>
      <td class="cell fee">
        <button class="fee-btn" data-chain-id="${row.id}" data-fee-usd="${row.feeUSD ?? ''}">
          ${feeLabel}
        </button>
      </td>
      <td class="cell speed mono">${speedLabel}</td>
      <td class="cell status">
        <span class="${statusClass}">${statusLabel}</span>
      </td>
      <td class="cell updated mono">${row.updatedLabel}</td>
    `;
    TBL.tbody.appendChild(tr);
  });
}

function applyFilter(){
  const q = (TBL.searchInput && TBL.searchInput.value || '').trim().toLowerCase();

  let filtered = STATE.rows.slice();
  if (q){
    filtered = filtered.filter(r => {
      const s1 = (r.chain || '').toLowerCase();
      const s2 = (r.ticker || '').toLowerCase();
      return s1.includes(q) || s2.includes(q);
    });
  }

  renderRows(filtered);
}

function glowRows(){
  if (!TBL.tbody) return;
  const rows = Array.from(TBL.tbody.querySelectorAll('tr'));
  rows.forEach(tr => {
    tr.classList.remove('row-glow');
    void tr.offsetWidth;
    tr.classList.add('row-glow');
  });
}

// ----- fee ツールチップ -----

function closeAllTooltips(){
  document.querySelectorAll('.fee-tooltip').forEach(el => el.remove());
  document.removeEventListener('click', handleTooltipOutsideClick);
}

function handleTooltipOutsideClick(e){
  const tooltip = e.target.closest('.fee-tooltip');
  const btn = e.target.closest('.fee-btn');
  if (!tooltip && !btn){
    closeAllTooltips();
  }
}

function buildTierHtmlForChain(chainId){
  const snapshot = STATE.snapshot;
  if (!snapshot || !snapshot[chainId] || !snapshot[chainId].tieredSpeed) return '';

  const snap = snapshot[chainId];
  if (!Array.isArray(snap.tiers) || !snap.tiers.length) return '';

  const lines = snap.tiers.map(tier => {
    const price = tier.gasPrice;
    const unit = tier.gasUnit || 'gwei';
    const feeUsd = tier.feeUSD;
    const minS = tier.speedMinSec;
    const maxS = tier.speedMaxSec;
    const label = tier.tier || '';
    const feeLabel = feeUsd != null ? fmtFiatFromUsd(feeUsd, STATE.fiat) : '—';
    const speedLabel =
      minS != null && maxS != null
        ? `${minS.toFixed(0)}–${maxS.toFixed(0)} s`
        : '—';

    return `
      <div class="cfs-tier-row mono">
        <span class="cfs-tier-name">${label}</span>
        <span class="cfs-tier-gas">${price} ${unit}</span>
        <span class="cfs-tier-fee">${feeLabel}</span>
        <span class="cfs-tier-speed">${speedLabel}</span>
      </div>
    `;
  });

  return `
    <div class="cfs-tooltip-title" style="font-weight:600;margin-top:4px;margin-bottom:2px;">Gas tiers</div>
    <div class="cfs-tier-table">
      ${lines.join('')}
    </div>
  `;
}

function setupFeeTooltipHandler(){
  if (!TBL.tbody) return;

  TBL.tbody.addEventListener('click', (e)=>{
    const btn = e.target.closest('.fee-btn');
    if (!btn){
      closeAllTooltips();
      return;
    }

    e.stopPropagation();
    closeAllTooltips();

    const feeUsd = parseFloat(btn.getAttribute('data-fee-usd') || '0');
    const chainId = btn.getAttribute('data-chain-id') || '';

    const cfg = FIAT_CONFIG[STATE.fiat] || FIAT_CONFIG.USD;
    let tooltipInfo = null;
    if (typeof buildFeeTooltipInfo === 'function') {
      tooltipInfo = buildFeeTooltipInfo(feeUsd, cfg.label, cfg.rate);
    } else {
      const exact = fmtFiatFromUsd(feeUsd, STATE.fiat) + ' ' + cfg.label;
      tooltipInfo = { exactLabel: exact };
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'fee-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.zIndex = '9999';

    // ★ ポップアップは常にライトグレーで固定（テーマ無視）
    tooltip.style.background = '#f3f4f6';          // light gray
    tooltip.style.color = '#111827';               // almost black
    tooltip.style.border = '1px solid '#d1d5db';    // gray-300
    tooltip.style.borderRadius = '8px';
    tooltip.style.padding = '8px 10px';
    tooltip.style.fontSize = '12px';
    tooltip.style.boxShadow = '0 8px 24px rgba(15,23,42,.12)';
    tooltip.style.maxWidth = '260px';

    const exactHtml = `
      <div class="cfs-tooltip-title" style="font-weight:600;margin-bottom:2px;">Exact fee</div>
      <div class="cfs-tooltip-line mono" style="margin-bottom:4px;">${tooltipInfo.exactLabel}</div>
    `;

    const tierHtml = buildTierHtmlForChain(chainId);

    tooltip.innerHTML = exactHtml + tierHtml;

    document.body.appendChild(tooltip);

    const rect = btn.getBoundingClientRect();
    const top = window.scrollY + rect.bottom + 6;
    const left = window.scrollX + rect.left;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    setTimeout(()=>{
      document.addEventListener('click', handleTooltipOutsideClick);
    }, 0);
  });
}

// ----- /api/snapshot から取得して rows に変換 -----

async function fetchAll(){
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
    const feeUSD = Number(snap.feeUSD) || 0;
    const speedSec = Number(snap.speedSec) || 0;
    const status = snap.status || decideStatus(feeUSD, speedSec);
    let updatedLabel = '—';

    if (snap.updated){
      const ts = typeof snap.updated === 'number' ? snap.updated : Date.parse(snap.updated);
      if (!Number.isNaN(ts)){
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        const ss = String(d.getSeconds()).padStart(2,'0');
        updatedLabel = `${hh}:${mm}:${ss}`;
      }
    }

    return {
      id: meta.id,
      chain: meta.chain,
      ticker: meta.ticker,
      feeUSD,
      speedSec,
      status,
      updatedLabel,
    };
  });

  return rows;
}

// ----- History API & simple sparkline chart (Phase3) -----

async function fetchHistory(){
  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error('Failed to fetch /api/history');
    const history = await res.json();
    if (!Array.isArray(history) || !history.length) {
      STATE.history = [];
      renderHistoryChart();
      return;
    }
    STATE.history = history;
    renderHistoryChart();
  } catch (err){
    console.error('history fetch error', err);
    // 履歴がなくてもテーブル自体は動かしたいので、ここでは UI エラーは出さない
  }
}

function renderHistoryChart(){
  const canvas = TBL.historyCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  const chainId = STATE.historyChain || 'bitcoin';

  const rows = (STATE.history || []).map((row, idx) => {
    const snap = row && row[chainId];
    if (!snap || snap.feeUSD == null) return null;
    const v = Number(snap.feeUSD);
    if (!isFinite(v)) return null;
    return { idx, v };
  }).filter(Boolean);

  const w = canvas.clientWidth || canvas.width || 320;
  const h = canvas.clientHeight || canvas.height || 120;
  canvas.width = w;
  canvas.height = h;

  ctx.clearRect(0,0,w,h);

  if (!rows.length) {
    return;
  }

  let min = rows.reduce((m,r)=>Math.min(m,r.v), rows[0].v);
  let max = rows.reduce((m,r)=>Math.max(m,r.v), rows[0].v);
  if (min === max) {
    const delta = min === 0 ? 1 : Math.abs(min) * 0.2;
    min = min - delta;
    max = max + delta;
  }

  const paddingX = 8;
  const paddingY = 8;
  const innerW = Math.max(1, w - paddingX * 2);
  const innerH = Math.max(1, h - paddingY * 2);

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
  ctx.strokeStyle = '#111827'; // ほぼ黒
  ctx.stroke();
}

// ----- Supabase へ snapshot を永続化するトリガー -----

async function pushHistory(){
  try {
    // フロントからトリガーするだけ。中で snapshot を取り直して Supabase に保存する。
    await fetch('/api/push-history', {
      method: 'POST'
    });
  } catch (err) {
    console.error('push-history error', err);
    // ここで UI エラーは出さない（保存失敗してもダッシュボード自体は動かす）
  }
}

// ----- リフレッシュ -----

async function refreshOnce({showGlow=true} = {}){
  try{
    if (TBL.refreshBtn) {
      TBL.refreshBtn.disabled = true;
    }

    const rows = await fetchAll();
    STATE.rows = rows;
    applyFilter(); // 検索語があればフィルタした結果を表示

    // 履歴も更新（グラフ用）
    fetchHistory().catch(()=>{});

    // Supabase への永続化をトリガー（失敗しても UI はそのまま）
    pushHistory().catch(()=>{});

    setStatus('Updated ' + nowTime());
    if (showGlow) glowRows();
  }catch(err){
    console.error(err);
    STATE.lastError = err;
    showErrorBanner('Failed to fetch data. Retrying in 30s…');
    setStatus('Update failed ' + nowTime());
    setTimeout(()=>refreshOnce({showGlow:false}), 30_000);
  }finally{
    if (TBL.refreshBtn) {
      TBL.refreshBtn.disabled = false;
    }
  }
}

// ----- イベント束ね -----

function setupEventHandlers(){
  if (TBL.refreshBtn) {
    TBL.refreshBtn.addEventListener('click', ()=>refreshOnce({showGlow:true}));
  }

  if (TBL.searchInput){
    let t=null;
    TBL.searchInput.addEventListener('input', ()=>{
      clearTimeout(t); t=setTimeout(applyFilter, 180); // debounce
    });
  }

  if (TBL.prioritySel){
    // Phase2 でもまだ UI だけ（将来用）
    TBL.prioritySel.addEventListener('change', ()=>{/* no-op for now */});
  }

  if (TBL.fiatSel){
    TBL.fiatSel.addEventListener('change', (e)=>{
      const val = e.target.value || 'USD';
      STATE.fiat = FIAT_CONFIG[val] ? val : 'USD';
      applyFilter(); // 通貨変更時も再描画
    });
  }

  if (TBL.historyChainSel){
    TBL.historyChainSel.addEventListener('change', (e)=>{
      const val = e.target.value || 'bitcoin';
      STATE.historyChain = val;
      renderHistoryChart();
    });
  }

  setupFeeTooltipHandler();
}

// ----- Boot -----

(function boot(){
  setStatus('Updated —');

  setupEventHandlers();
  // 初回ロード
  refreshOnce({showGlow:false});
  // 以降は interval 更新
  clearInterval(STATE.timer);
  STATE.timer = setInterval(()=>refreshOnce({showGlow:true}), STATE.intervalMs);
})();
