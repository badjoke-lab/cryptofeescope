// FeeSnapshot JSON schema (demo)
// {
//   generatedAt: string,
//   vsCurrencies: string[], // ["usd", "jpy"]
//   chains: {
//     [key: string]: {
//       label: string,
//       feeUSD: number,
//       feeJPY: number,
//       speedSec: number,
//       status: string,
//       updated: string,
//       native: { amount: number, symbol: string },
//       tiers: { label: string, feeUSD: number, feeJPY: number }[],
//       source: { price: { provider: string, id: string } }
//     }
//   }
// }

// ----- Theme helpers -----
const THEME_KEY = 'cfs-theme';

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch (e) {
    // localStorage 使えない環境ではデフォルトにフォールバック
  }

  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  document.body.classList.toggle('dark', t === 'dark');
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch (e) {
    // localStorage エラーは無視
  }
}

// ----- Snapshot fetch -----
// Cloudflare Pages の公開ルート: /
// リポジトリ構成: cryptofeescope/data/fee_snapshot_demo.json
// → ブラウザからは /data/fee_snapshot_demo.json でアクセスできる
const SNAPSHOT_URL = "data/fee_snapshot_demo.json";

async function fetchFeeSnapshot() {
  const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });

  if (!res.ok) {
    // 404 や 500 ならここで止める
    const text = await res.text().catch(() => "");
    console.error("Failed to load fee snapshot:", res.status, text.slice(0, 200));
    throw new Error(`Failed to load fee snapshot: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  // JSON ではなく HTML (例: 404で index.html が返ってくる) の場合、
  // Unexpected token '<' を避けて原因をログに出す
  if (!contentType.includes("application/json") && text.trim().startsWith("<")) {
    console.error("Snapshot response is HTML, not JSON. Check file path /data/fee_snapshot_demo.json.");
    console.error(text.slice(0, 200));
    throw new Error("Snapshot is not JSON. Maybe /data/fee_snapshot_demo.json is missing or misconfigured.");
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse snapshot JSON:", e);
    console.error("Raw text snippet:", text.slice(0, 200));
    throw e;
  }
}

// ----- State & formatters -----
const state = {
  snapshot: null,
  currency: "usd", // "usd" | "jpy"
};

function formatFiat(value) {
  if (value == null || Number.isNaN(value)) return "—";
  if (value < 0.001) {
    return value.toExponential(2);
  }
  return value.toFixed(3);
}

function formatUpdated(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// ----- Rendering -----
function renderTable() {
  const tbody = document.getElementById("fee-table-body");
  const header = document.getElementById("fee-header");
  if (header) {
    header.textContent = state.currency === "usd" ? "Fee (USD)" : "Fee (JPY)";
  }
  if (!tbody || !state.snapshot) return;

  const currency = state.currency; // "usd" or "jpy"
  const chains = state.snapshot.chains || {};

  const rows = Object.entries(chains).map(([key, chain]) => {
    const fee = currency === "usd" ? chain.feeUSD : chain.feeJPY;
    const feeStr = formatFiat(fee);
    const speedStr = chain.speedSec != null ? `${chain.speedSec} sec` : "—";
    const statusStr = chain.status || "unknown";

    // キーを利用した簡易ticker。後でchains.jsonと統合予定
    const ticker = (key || "?").toUpperCase();

    return `
      <tr class="fee-row status-${statusStr}">
        <td>${chain.label || key}</td>
        <td>${ticker}</td>
        <td>${feeStr}</td>
        <td>${speedStr}</td>
        <td class="status-cell status-${statusStr}">${statusStr}</td>
        <td>${formatUpdated(chain.updated)}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.join("");
}

// ----- Lifecycle -----
async function loadSnapshotAndRender() {
  const updatedEl = document.getElementById("updated-label");
  if (updatedEl) {
    updatedEl.textContent = "Loading…";
  }
  try {
    const snapshot = await fetchFeeSnapshot();
    state.snapshot = snapshot;
    if (updatedEl) {
      updatedEl.textContent = new Date(snapshot.generatedAt).toLocaleString();
    }
    renderTable();
  } catch (err) {
    console.error(err);
    if (updatedEl) {
      updatedEl.textContent = "Error loading data";
    }
  }
}

function bindCurrencyButtons() {
  const usdBtn = document.getElementById("currency-usd");
  const jpyBtn = document.getElementById("currency-jpy");
  const map = { usd: usdBtn, jpy: jpyBtn };

  function syncActive() {
    Object.entries(map).forEach(([key, el]) => {
      if (!el) return;
      el.classList.toggle("active", state.currency === key);
    });
  }

  if (usdBtn) {
    usdBtn.addEventListener("click", () => {
      state.currency = "usd";
      syncActive();
      renderTable();
    });
  }
  if (jpyBtn) {
    jpyBtn.addEventListener("click", () => {
      state.currency = "jpy";
      syncActive();
      renderTable();
    });
  }

  syncActive();
}

// ----- Init -----
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getInitialTheme());

  const refreshBtn = document.getElementById("refresh-button");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadSnapshotAndRender();
    });
  }

  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = document.body.classList.contains("dark") ? "dark" : "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  bindCurrencyButtons();
  loadSnapshotAndRender();
});
