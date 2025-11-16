// CryptoFeeScope - Stats page (preview)

const CHAINS = [
  { id: 'bitcoin',  label: 'Bitcoin (L1)' },
  { id: 'ethereum', label: 'Ethereum (L1)' },
  { id: 'arbitrum', label: 'Arbitrum (L2 on ETH)' },
  { id: 'optimism', label: 'Optimism (L2 on ETH)' },
  { id: 'solana',   label: 'Solana' },
];

const FIAT = { symbol: '$', rate: 1 }; // とりあえず USD 固定（将来拡張）

const els = {
  chainSel:   document.getElementById('statsChain'),
  rangeSel:   document.getElementById('statsRange'),
  summary:    document.getElementById('statsSummary'),
  canvas:     document.getElementById('statsCanvas'),
};

const STATE = {
  history: [],
  chainId: 'bitcoin',
};

function fmtMoney(v) {
  if (!isFinite(v)) return '—';
  if (v >= 1) return FIAT.symbol + v.toFixed(2);
  if (v >= 0.01) return FIAT.symbol + v.toFixed(3);
  return '< ' + FIAT.symbol + '0.001';
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error('Failed to fetch /api/history');
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('History is not array');
    STATE.history = json;
    render();
  } catch (err) {
    console.error(err);
    if (els.summary) {
      els.summary.textContent = 'Failed to load history.';
    }
  }
}

function extractSeries(chainId) {
  const series = [];
  (STATE.history || []).forEach((snap, idx) => {
    const chain = snap && snap[chainId];
    if (!chain || chain.feeUSD == null) return;
    const v = Number(chain.feeUSD);
    if (!isFinite(v)) return;
    series.push({ idx, v });
  });
  return series;
}

function renderSummary(series) {
  if (!els.summary) return;

  if (!series.length) {
    els.summary.textContent = 'No history yet for this chain.';
    return;
  }

  let min = series[0].v;
  let max = series[0].v;
  let sum = 0;
  series.forEach(pt => {
    if (pt.v < min) min = pt.v;
    if (pt.v > max) max = pt.v;
    sum += pt.v;
  });

  const avg = sum / series.length;

  els.summary.innerHTML = `
    <div><strong>${CHAINS.find(c => c.id === STATE.chainId)?.label || STATE.chainId}</strong></div>
    <div class="stats-summary-row">
      <span>Min: ${fmtMoney(min)}</span>
      <span>Max: ${fmtMoney(max)}</span>
      <span>Avg: ${fmtMoney(avg)}</span>
      <span>Samples: ${series.length}</span>
    </div>
  `;
}

function renderChart(series) {
  const canvas = els.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 220;
  canvas.width = w;
  canvas.height = h;

  ctx.clearRect(0, 0, w, h);

  if (!series.length) {
    // データがないときは何も描かない（背景だけ）
    return;
  }

  let min = series[0].v;
  let max = series[0].v;
  series.forEach(pt => {
    if (pt.v < min) min = pt.v;
    if (pt.v > max) max = pt.v;
  });
  if (min === max) {
    const delta = min === 0 ? 1 : Math.abs(min) * 0.2;
    min -= delta;
    max += delta;
  }

  const paddingX = 16;
  const paddingY = 16;
  const innerW = Math.max(1, w - paddingX * 2);
  const innerH = Math.max(1, h - paddingY * 2);
  const n = series.length;
  const dx = n > 1 ? innerW / (n - 1) : 0;

  ctx.beginPath();
  series.forEach((pt, i) => {
    const x = paddingX + dx * i;
    const ratio = (pt.v - min) / (max - min || 1);
    const y = paddingY + innerH - innerH * ratio;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#111827'; // ほぼ黒
  ctx.stroke();
}

function render() {
  const series = extractSeries(STATE.chainId);
  renderSummary(series);
  renderChart(series);
}

function setupEvents() {
  if (els.chainSel) {
    els.chainSel.addEventListener('change', e => {
      STATE.chainId = e.target.value || 'bitcoin';
      render();
    });
  }
  // rangeSel は今は「all」だけ。将来 24h / 3d などに拡張。
}

(function boot(){
  if (els.canvas) {
    // ある程度の高さを与えておく
    els.canvas.style.width = '100%';
    els.canvas.style.height = '260px';
  }
  setupEvents();
  loadHistory();
})();
