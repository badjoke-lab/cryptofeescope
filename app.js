// FeeSnapshot JSON schema (demo, Phase 1)
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
//       priceChange24hPct?: number,
//       native: { amount: number, symbol: string },
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
let historyMeta = null;

const METHOD_ANCHORS = {
  btc: "btc",
  eth: "eth",
  bsc: "bsc",
  arbitrum: "arbitrum",
  optimism: "optimism",
  sol: "solana",
  tron: "tron",
  avax: "avax",
  xrp: "xrp",
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
    return "0.000";
  }

  if (abs >= 1e-6 && abs < 0.01) {
    const fixed = trimTrailingZeros(abs.toFixed(6));
    return `${sign}${fixed}`;
  }

  if (abs >= 0.01 && abs < 1000) {
    return `${sign}${abs.toFixed(3)}`;
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
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function formatAge(ageSec) {
  if (typeof ageSec !== "number" || !Number.isFinite(ageSec) || ageSec < 0) return "—";
  if (ageSec < 30) return "just now";
  if (ageSec < 90) return "1 min ago";
  if (ageSec < 3600) return `${Math.round(ageSec / 60)} min ago`;
  if (ageSec < 86400) return `${Math.round(ageSec / 3600)} h ago`;
  return `${Math.round(ageSec / 86400)} d ago`;
}

// ----- Rendering -----
function renderTable() {
  const tbody = document.getElementById("fee-table-body");
  const tbodyMobile = document.getElementById("fee-table-body-mobile");
  const header = document.getElementById("fee-header");
  if (header) {
    header.textContent = state.currency === "usd" ? "Fee (est. USD)" : "Fee (est. JPY)";
  }
  if (!state.snapshot) return;

  const currency = state.currency; // "usd" or "jpy"
  const chains = state.snapshot.chains || {};

  if (tbody) {
    tbody.textContent = "";
  }
  if (tbodyMobile) {
    tbodyMobile.textContent = "";
  }

  Object.entries(chains).forEach(([key, chain]) => {
    const currencyKey = currency === "usd" ? "feeUSD" : "feeJPY";
    const currencyCode = currency.toUpperCase();
    const rawFee = chain[currencyKey];

    const displayFee = formatFiat(rawFee);
    const displayFeeApprox = displayFee === "—" ? displayFee : `≈ ${displayFee}`;
    const feeTitle =
      typeof rawFee === "number" && Number.isFinite(rawFee)
        ? `${toPlainNumberString(rawFee)} ${currencyCode}`
        : "";
    const speedStr = chain.speedSec != null ? `${chain.speedSec} sec` : "—";
    const speedApprox = speedStr === "—" ? speedStr : `≈ ${speedStr}`;
    const statusStr = chain.status || "unknown";
    const changePct = chain.priceChange24hPct;
    let changeText = "—";
    let changeClass = "change-flat";
    if (typeof changePct === "number" && Number.isFinite(changePct)) {
      const magnitude = Math.abs(changePct);
      const decimals = magnitude >= 1 ? 1 : 2;
      const formatted = changePct.toFixed(decimals);
      const sign = changePct > 0 ? "+" : changePct < 0 ? "" : "";
      changeText = `${sign}${trimTrailingZeros(formatted)}%`;
      changeClass = changePct > 0 ? "change-pos" : changePct < 0 ? "change-neg" : "change-flat";
    }

    // キーを利用した簡易ticker。後でchains.jsonと統合予定
    const ticker = (key || "?").toUpperCase();

    if (tbody) {
      const tr = document.createElement("tr");
      tr.classList.add("fee-row", `status-${statusStr}`);

      const tdChain = document.createElement("td");
      tdChain.classList.add("col-chain", "chain-cell");
      const chainLabelEl = document.createElement("div");
      chainLabelEl.classList.add("chain-label");
      chainLabelEl.textContent = chain.label || key;
      const methodAnchor = METHOD_ANCHORS[key];
      if (methodAnchor) {
        const infoLink = document.createElement("a");
        infoLink.classList.add("method-link");
        infoLink.href = `/methods/#${methodAnchor}`;
        infoLink.setAttribute("aria-label", "See methodology for this chain");
        infoLink.textContent = "ⓘ";
        chainLabelEl.appendChild(infoLink);
      }
      tdChain.append(chainLabelEl);

      const tdTicker = document.createElement("td");
      tdTicker.classList.add("col-ticker", "ticker-cell");
      tdTicker.textContent = ticker;

      const tdFee = document.createElement("td");
      tdFee.classList.add("col-fee", "fee-cell");
      tdFee.textContent = displayFeeApprox;
      if (feeTitle) {
        tdFee.title = feeTitle;
      }

      const tdChange = document.createElement("td");
      tdChange.classList.add("col-change", "change-cell", changeClass);
      tdChange.textContent = changeText;

      const tdSpeed = document.createElement("td");
      tdSpeed.classList.add("col-speed", "speed-cell");
      tdSpeed.textContent = speedApprox;

      const tdStatus = document.createElement("td");
      tdStatus.classList.add("col-status", "status-cell", `status-${statusStr}`);
      tdStatus.textContent = statusStr;

      tr.append(tdChain, tdTicker, tdFee, tdChange, tdSpeed, tdStatus);
      tbody.appendChild(tr);
    }

    if (tbodyMobile) {
      const trMobile = document.createElement("tr");
      trMobile.classList.add("fee-row-mobile", `status-${statusStr}`);

      const tdMobileLeft = document.createElement("td");
      tdMobileLeft.classList.add("cell-mobile-left");
      const chainNameMobile = document.createElement("div");
      chainNameMobile.classList.add("chain-name-mobile");
      chainNameMobile.textContent = chain.label || key;
      const methodAnchorMobile = METHOD_ANCHORS[key];
      if (methodAnchorMobile) {
        const infoLinkMobile = document.createElement("a");
        infoLinkMobile.classList.add("method-link");
        infoLinkMobile.href = `/methods/#${methodAnchorMobile}`;
        infoLinkMobile.setAttribute("aria-label", "See methodology for this chain");
        infoLinkMobile.textContent = "ⓘ";
        chainNameMobile.appendChild(infoLinkMobile);
      }
      const chainTickerMobile = document.createElement("div");
      chainTickerMobile.classList.add("chain-ticker-mobile");
      chainTickerMobile.textContent = ticker;
      tdMobileLeft.append(chainNameMobile, chainTickerMobile);

      const tdMobileRight = document.createElement("td");
      tdMobileRight.classList.add("cell-mobile-right");

      const metricsTop = document.createElement("div");
      metricsTop.classList.add("metrics-top");
      const feeValueMobile = document.createElement("span");
      feeValueMobile.classList.add("fee-value-mobile");
      feeValueMobile.textContent = displayFeeApprox;
      if (feeTitle) {
        feeValueMobile.title = feeTitle;
      }
      const changeValueMobile = document.createElement("span");
      changeValueMobile.classList.add("change-value-mobile", changeClass);
      changeValueMobile.textContent = changeText;
      metricsTop.append("Fee (est.) ", feeValueMobile, " · 24h ", changeValueMobile);

      const metricsBottom = document.createElement("div");
      metricsBottom.classList.add("metrics-bottom");
      const speedMobile = document.createElement("span");
      speedMobile.classList.add("speed-mobile");
      speedMobile.textContent = speedApprox;
      const statusMobile = document.createElement("span");
      statusMobile.classList.add("status-mobile", "status-cell", `status-${statusStr}`);
      statusMobile.textContent = statusStr;
      metricsBottom.append(speedMobile, " · ", statusMobile);

      tdMobileRight.append(metricsTop, metricsBottom);
      trMobile.append(tdMobileLeft, tdMobileRight);
      tbodyMobile.appendChild(trMobile);
    }
  });
}

function renderFreshness() {
  const freshnessEl = document.getElementById("history-freshness");
  if (!freshnessEl) return;
  if (!historyMeta) {
    freshnessEl.textContent = "Loading…";
    return;
  }
  const age = typeof historyMeta.ageSecOverall === "number" ? historyMeta.ageSecOverall : null;
  freshnessEl.textContent = age == null ? "—" : formatAge(age);
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
      updatedEl.textContent = formatUpdated(snapshot.generatedAt);
    }
    renderTable();
    renderFreshness();
  } catch (err) {
    console.error(err);
    if (updatedEl) {
      updatedEl.textContent = "Error loading data";
    }
    renderFreshness();
  }
}

async function fetchHistoryMeta() {
  const freshnessEl = document.getElementById("history-freshness");
  if (freshnessEl) freshnessEl.textContent = "Loading…";
  try {
    const res = await fetch("/api/meta");
    if (!res.ok) throw new Error("Failed to load meta");
    historyMeta = await res.json();
    renderFreshness();
  } catch (err) {
    console.error(err);
    historyMeta = null;
    renderFreshness();
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

function bindNavToggle() {
  const nav = document.getElementById("global-nav");
  const toggle = document.getElementById("nav-toggle");
  if (!nav || !toggle) return;

  const syncForViewport = () => {
    if (window.innerWidth > 768) {
      nav.classList.add("open");
      toggle.setAttribute("aria-expanded", "true");
    } else {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  };

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  window.addEventListener("resize", syncForViewport);
  syncForViewport();
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
  bindNavToggle();
  loadSnapshotAndRender();
  fetchHistoryMeta();
  setInterval(loadSnapshotAndRender, 60_000);
  setInterval(fetchHistoryMeta, 60_000);
});
