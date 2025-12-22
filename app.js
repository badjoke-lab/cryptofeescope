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
  searchQuery: "",
  filterStatus: "all",
  sortBy: "default",
  allRows: [],
};
let historyMeta = null;

const VALID_STATUSES = ["all", "fast", "normal", "slow", "unknown", "error"];
const VALID_SORTS = [
  "default",
  "fee_asc",
  "fee_desc",
  "speed_asc",
  "speed_desc",
  "chain_asc",
  "chain_desc",
];

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

function formatFiat(value, currency) {
  const currencyCode = typeof currency === "string" ? currency.toUpperCase() : "USD";
  return formatFeeWithPrecision(value, currencyCode);
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

function applyFeeDisplay(el, parts, displayText) {
  if (!el || !parts) return;
  if (typeof renderFeeValue === "function") {
    renderFeeValue(el, parts, displayText);
    return;
  }

  const text = displayText ?? parts.display;
  el.textContent = text;
}

function buildFeeTitle(rawUsd, rawJpy, currencyCode) {
  const usdPart = Number.isFinite(rawUsd) ? `Exact feeUsd: ${toPlainNumberString(rawUsd)}` : "";
  if (currencyCode === "JPY") {
    const jpyPart = Number.isFinite(rawJpy) ? `feeJpy: ${toPlainNumberString(rawJpy)}` : "";
    return [usdPart, jpyPart].filter(Boolean).join(" | ");
  }
  return usdPart;
}

// ----- Rendering -----
function buildRowsFromSnapshot(snapshot) {
  if (!snapshot || !snapshot.chains) return [];
  return Object.entries(snapshot.chains).map(([key, chain], index) => ({
    key,
    index,
    ...chain,
  }));
}

function getTicker(row) {
  if (!row) return "";
  if (row.native && typeof row.native.symbol === "string" && row.native.symbol.trim()) {
    return row.native.symbol.trim();
  }
  if (row.ticker && typeof row.ticker === "string" && row.ticker.trim()) {
    return row.ticker.trim();
  }
  return (row.key || "").toUpperCase();
}

function matchesSearch(row, query) {
  if (!query) return true;
  const haystack = [row.label, row.key, getTicker(row)]
    .filter(Boolean)
    .map((s) => s.toString().toLowerCase())
    .join("\n");
  return haystack.includes(query);
}

function compareWithNullsLast(a, b, direction = "asc") {
  const dir = direction === "desc" ? -1 : 1;
  const aNull = a == null || !Number.isFinite(a);
  const bNull = b == null || !Number.isFinite(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a > b) return dir;
  if (a < b) return -dir;
  return 0;
}

function sortRows(rows) {
  const sortKey = state.sortBy;
  if (sortKey === "default") return rows;

  const currencyKey = state.currency === "jpy" ? "feeJPY" : "feeUSD";

  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sortKey === "fee_asc") {
      return compareWithNullsLast(a[currencyKey], b[currencyKey], "asc");
    }
    if (sortKey === "fee_desc") {
      return compareWithNullsLast(a[currencyKey], b[currencyKey], "desc");
    }
    if (sortKey === "speed_asc") {
      return compareWithNullsLast(a.speedSec, b.speedSec, "asc");
    }
    if (sortKey === "speed_desc") {
      return compareWithNullsLast(a.speedSec, b.speedSec, "desc");
    }
    if (sortKey === "chain_asc") {
      return (a.label || "").localeCompare(b.label || "");
    }
    if (sortKey === "chain_desc") {
      return (b.label || "").localeCompare(a.label || "");
    }
    return 0;
  });
  return sorted;
}

function getVisibleRows() {
  const baseRows = state.allRows || [];
  const query = state.searchQuery.trim().toLowerCase();
  const filtered = baseRows.filter((row) => {
    const rowStatus = (row.status || "unknown").toLowerCase();
    const statusMatch = state.filterStatus === "all" || rowStatus === state.filterStatus;
    return statusMatch && matchesSearch(row, query);
  });
  return sortRows(filtered);
}

function renderTable(rows) {
  const tbody = document.getElementById("fee-table-body");
  const tbodyMobile = document.getElementById("fee-table-body-mobile");
  const header = document.getElementById("fee-header");
  if (header) {
    header.textContent = state.currency === "usd" ? "Fee (est. USD)" : "Fee (est. JPY)";
  }
  const emptyNote = document.getElementById("empty-note");

  if (!state.snapshot) return;

  const currency = state.currency; // "usd" or "jpy"

  const rowsToRender = Array.isArray(rows) ? rows : [];

  if (tbody) {
    tbody.textContent = "";
  }
  if (tbodyMobile) {
    tbodyMobile.textContent = "";
  }

  if (!rowsToRender.length && emptyNote) {
    emptyNote.classList.remove("hidden");
  } else if (emptyNote) {
    emptyNote.classList.add("hidden");
  }

  rowsToRender.forEach((chain) => {
    const key = chain.key;
    const currencyKey = currency === "usd" ? "feeUSD" : "feeJPY";
    const currencyCode = currency.toUpperCase();
    const feeParts = formatFeePair({
      usd: chain.feeUSD,
      jpy: chain.feeJPY,
    }, { currency: currencyCode });
    const displayFee = feeParts.display;
    const displayFeeApprox = displayFee === "—" ? displayFee : `≈ ${displayFee}`;
    const feeTitle = buildFeeTitle(chain.feeUSD, chain.feeJPY, currencyCode);
    const speedStr = chain.speedSec != null ? `${chain.speedSec} sec` : "—";
    const speedApprox = speedStr === "—" ? speedStr : `≈ ${speedStr}`;
    const statusStr = (chain.status || "unknown").toLowerCase();
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
    const ticker = getTicker(chain);

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
      applyFeeDisplay(tdFee, feeParts, displayFeeApprox);
      if (feeTitle) {
        tdFee.title = feeTitle;
      }
      tdFee.dataset.displayValue = displayFeeApprox;

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
      applyFeeDisplay(feeValueMobile, feeParts, displayFeeApprox);
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
    state.allRows = buildRowsFromSnapshot(snapshot);
    if (updatedEl) {
      updatedEl.textContent = formatUpdated(snapshot.generatedAt);
    }
    renderTable(getVisibleRows());
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
      renderTable(getVisibleRows());
    });
  }
  if (jpyBtn) {
    jpyBtn.addEventListener("click", () => {
      state.currency = "jpy";
      syncActive();
      renderTable(getVisibleRows());
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

function applyQueryParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const qParam = params.get("q");
  const statusParam = params.get("status");
  const sortParam = params.get("sort");

  state.searchQuery = typeof qParam === "string" ? qParam : "";
  const normalizedStatus = typeof statusParam === "string" ? statusParam.toLowerCase() : null;
  if (VALID_STATUSES.includes(normalizedStatus)) {
    state.filterStatus = normalizedStatus;
  }
  const normalizedSort = typeof sortParam === "string" ? sortParam.toLowerCase() : null;
  if (VALID_SORTS.includes(normalizedSort)) {
    state.sortBy = normalizedSort;
  }
}

function syncQueryParams() {
  const params = new URLSearchParams(window.location.search);

  if (state.searchQuery) params.set("q", state.searchQuery);
  else params.delete("q");

  if (state.filterStatus && state.filterStatus !== "all") params.set("status", state.filterStatus);
  else params.delete("status");

  if (state.sortBy && state.sortBy !== "default") params.set("sort", state.sortBy);
  else params.delete("sort");

  const newQuery = params.toString();
  const newUrl = newQuery ? `${window.location.pathname}?${newQuery}` : window.location.pathname;
  if (newUrl !== window.location.pathname + window.location.search) {
    history.replaceState({}, "", newUrl);
  }
}

function bindTableControls() {
  const searchInput = document.getElementById("search");
  const statusSelect = document.getElementById("statusFilter");
  const sortSelect = document.getElementById("sortBy");

  if (searchInput) {
    searchInput.value = state.searchQuery;
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      syncQueryParams();
      renderTable(getVisibleRows());
    });
  }

  if (statusSelect) {
    statusSelect.value = VALID_STATUSES.includes(state.filterStatus) ? state.filterStatus : "all";
    statusSelect.addEventListener("change", () => {
      const value = statusSelect.value;
      state.filterStatus = VALID_STATUSES.includes(value) ? value : "all";
      syncQueryParams();
      renderTable(getVisibleRows());
    });
  }

  if (sortSelect) {
    sortSelect.value = VALID_SORTS.includes(state.sortBy) ? state.sortBy : "default";
    sortSelect.addEventListener("change", () => {
      const value = sortSelect.value;
      state.sortBy = VALID_SORTS.includes(value) ? value : "default";
      syncQueryParams();
      renderTable(getVisibleRows());
    });
  }
}

// ----- Init -----
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getInitialTheme());
  applyQueryParamsFromUrl();

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

  bindTableControls();
  bindCurrencyButtons();
  bindNavToggle();
  loadSnapshotAndRender();
  fetchHistoryMeta();
  setInterval(loadSnapshotAndRender, 60_000);
  setInterval(fetchHistoryMeta, 60_000);
});
