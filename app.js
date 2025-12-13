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

function toPlainNumberString(value) {
  if (!Number.isFinite(value)) return String(value);
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  const str = String(absValue);
  if (!/e/i.test(str)) return `${sign}${str}`;

  const [mantissa, exponentPart] = str.split("e");
  const exponent = parseInt(exponentPart, 10);
  if (!Number.isFinite(exponent)) return `${sign}${str}`;

  const [integerPart, fractionalPart = ""] = mantissa.split(".");
  const digits = integerPart + fractionalPart;
  if (exponent < 0) {
    const zeros = "0".repeat(Math.max(0, Math.abs(exponent) - 1));
    return `${sign}0.${zeros}${digits}`.replace(/\.?0+$/, "");
  }

  const decimalShift = exponent - fractionalPart.length;
  if (decimalShift >= 0) {
    return `${sign}${digits}${"0".repeat(decimalShift)}`;
  }

  const splitIndex = digits.length + decimalShift;
  return `${sign}${digits.slice(0, splitIndex)}.${digits.slice(splitIndex)}`.replace(/\.?0+$/, "");
}

function trimTrailingZeros(str) {
  return str.includes(".") ? str.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : str;
}

function formatFiat(value) {
  if (value == null || Number.isNaN(value)) return "—";

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs > 0 && abs < 1e-6) {
    return `${sign}< 0.000001`;
  }

  if (abs === 0) {
    return `${sign}0.000`;
  }

  if (abs >= 1e-6 && abs < 0.01) {
    const fixed = trimTrailingZeros(abs.toFixed(6));
    return `${sign}${fixed}`;
  }

  if (abs >= 0.01 && abs < 1000) {
    const fixed = abs.toFixed(3);
    return `${sign}${fixed}`;
  }

  const suffix = abs >= 1_000_000 ? "m" : "k";
  const divisor = suffix === "m" ? 1_000_000 : 1_000;
  const base = abs / divisor;
  const decimals = base >= 10 ? 1 : 2;
  const compact = trimTrailingZeros(base.toFixed(decimals));
  return `${sign}${compact}${suffix}`;
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

  tbody.textContent = "";

  Object.entries(chains).forEach(([key, chain]) => {
    const currencyKey = currency === "usd" ? "feeUSD" : "feeJPY";
    const tiers = Array.isArray(chain.tiers) ? chain.tiers : [];
    const standardTier = tiers[0];
    const fee =
      standardTier && typeof standardTier[currencyKey] === "number"
        ? standardTier[currencyKey]
        : chain[currencyKey];

    const feeStr = formatFiat(fee);
    const speedStr = chain.speedSec != null ? `${chain.speedSec} sec` : "—";
    const statusStr = chain.status || "unknown";
    const change = chain.priceChange24hPct;
    let changeText = "—";
    let changeClass = "change-flat";
    let changeTitle = "No 24h data (demo API)";

    if (typeof change === "number" && !Number.isNaN(change)) {
      const sign = change > 0 ? "+" : "";
      const rounded = change.toFixed(1);
      changeText = `${sign}${rounded}%`;
      changeTitle = `${sign}${change.toFixed(2)}% over last 24h`;

      if (change > 0.1) changeClass = "change-pos";
      else if (change < -0.1) changeClass = "change-neg";
    }

    // キーを利用した簡易ticker。後でchains.jsonと統合予定
    const ticker = (key || "?").toUpperCase();

    const tr = document.createElement("tr");
    tr.classList.add("fee-row", `status-${statusStr}`);

    const tdChain = document.createElement("td");
    tdChain.textContent = chain.label || key;

    const tdTicker = document.createElement("td");
    tdTicker.textContent = ticker;

    const tdFee = document.createElement("td");
    tdFee.classList.add("fee-cell");
    tdFee.textContent = feeStr;
    if (fee != null && !Number.isNaN(fee)) {
      tdFee.title = `${toPlainNumberString(fee)} ${currency.toUpperCase()}`;
    }

    if (tiers.length > 1) {
      const tierNote = document.createElement("div");
      tierNote.classList.add("tier-note");
      tierNote.textContent = `Standard · +${tiers.length - 1} tiers`;
      tdFee.appendChild(tierNote);
    }

    const tdChange = document.createElement("td");
    tdChange.classList.add("change-cell", changeClass);
    tdChange.textContent = changeText;
    tdChange.title = changeTitle;

    const tdSpeed = document.createElement("td");
    tdSpeed.textContent = speedStr;

    const tdStatus = document.createElement("td");
    tdStatus.classList.add("status-cell", `status-${statusStr}`);
    tdStatus.textContent = statusStr;

    const tdUpdated = document.createElement("td");
    tdUpdated.textContent = formatUpdated(chain.updated);

    tr.append(tdChain, tdTicker, tdFee, tdChange, tdSpeed, tdStatus, tdUpdated);
    tbody.appendChild(tr);
  });
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
