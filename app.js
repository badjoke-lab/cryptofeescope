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
const pageState = window.CryptoFeeScopePageState?.createPageState("top-state");
const safeFetchJson = window.CryptoFeeScopePageState?.safeFetchJson;
const normalizeError = window.CryptoFeeScopePageState?.normalizeError;

async function fetchFeeSnapshot() {
  if (typeof safeFetchJson !== "function") {
    const res = await fetch(SNAPSHOT_URL, { cache: "no-store" });
    return res.json();
  }

  return safeFetchJson(SNAPSHOT_URL, { cache: "no-store" }, (snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return "Snapshot response missing.";
    if (!snapshot.chains || typeof snapshot.chains !== "object") return "Snapshot missing chains.";
    return null;
  });
}

// ----- State & formatters -----
const state = {
  snapshot: null,
  currency: "usd", // "usd" | "jpy"
  searchQuery: "",
  filterStatus: "all",
  sortBy: "default",
  allRows: [],
  dataEmpty: false,
};
let historyMeta = null;

const VALID_STATUSES = ["all", "fast", "normal", "slow", "degraded"];
const STATUS_LABELS = {
  fast: "Fast",
  normal: "Normal",
  slow: "Slow",
  degraded: "Degraded",
};
const DEGRADED_STATUSES = new Set(["unknown", "error", "degraded"]);
const VALID_SORTS = [
  "default",
  "fee_asc",
  "fee_desc",
  "speed_asc",
  "speed_desc",
  "chain_asc",
  "chain_desc",
];

const SHARED_CHAINS = [
  "btc",
  "eth",
  "bsc",
  "sol",
  "tron",
  "avax",
  "xrp",
  "arbitrum",
  "optimism",
  "gnosis",
  "fantom",
  "cronos",
];
const DEFAULT_CHAIN = "eth";

const URL_STATE_DEFAULTS = {
  q: "",
  chains: [DEFAULT_CHAIN],
  sort: null,
  dir: null,
  currency: "usd",
  range: "24h",
};

const URL_STATE_CONFIG = {
  allowedChains: SHARED_CHAINS,
  allowedSorts: ["fee", "speed", "chain"],
  allowedDirs: ["asc", "desc"],
  allowedCurrencies: ["usd", "jpy"],
  allowedRanges: ["24h", "7d"],
};

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
  gnosis: "gnosis",
  fantom: "fantom",
  cronos: "cronos",
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

function normalizeMetaPayload(payload) {
  return payload?.data ?? payload;
}

function formatHealthDetailValue(value) {
  if (value == null) return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  if (typeof value === "string") return value.trim() ? value : "—";
  return "—";
}

function renderHealthDetails(meta) {
  const details = {
    lastWriteAt: meta?.lastWriteAt,
    lastOkAt: meta?.lastOkAt,
    points24h: meta?.points24h,
    maxGapHours24h: meta?.maxGapHours24h,
    lastFetchError: meta?.lastFetchError,
    lastFetchErrorAt: meta?.lastFetchErrorAt,
  };
  Object.entries(details).forEach(([key, value]) => {
    const el = document.querySelector(`[data-health-detail="${key}"]`);
    if (el) {
      el.textContent = formatHealthDetailValue(value);
    }
  });
}

function parseIsoToUnix(iso) {
  if (typeof iso !== "string") return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function resolveMetaTimestamp(meta, tsKey, isoKey) {
  if (meta && typeof meta[tsKey] === "number") return meta[tsKey];
  return parseIsoToUnix(meta?.[isoKey]);
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

function normalizeStatus(status) {
  const raw = (status || "unknown").toLowerCase();
  return DEGRADED_STATUSES.has(raw) ? "degraded" : raw;
}

function formatStatusLabel(status) {
  const normalized = normalizeStatus(status);
  return STATUS_LABELS[normalized] || "Degraded";
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
    const rowStatus = normalizeStatus(row.status);
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
    header.textContent = "Estimated Tx Fee (USD/JPY)";
  }
  const emptyNote = document.getElementById("empty-note");

  if (!state.snapshot) {
    if (tbody) tbody.textContent = "";
    if (tbodyMobile) tbodyMobile.textContent = "";
    if (emptyNote) emptyNote.classList.add("hidden");
    return;
  }

  const currency = state.currency; // "usd" or "jpy"

  const rowsToRender = Array.isArray(rows) ? rows : [];

  if (tbody) {
    tbody.textContent = "";
  }
  if (tbodyMobile) {
    tbodyMobile.textContent = "";
  }

  if (state.dataEmpty && emptyNote) {
    emptyNote.classList.add("hidden");
  } else if (!rowsToRender.length && emptyNote) {
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
    const statusClass = normalizeStatus(chain.status);
    const statusLabel = formatStatusLabel(chain.status);
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
      tr.classList.add("fee-row", `status-${statusClass}`);

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
      tdStatus.classList.add("col-status", "status-cell", `status-${statusClass}`);
      tdStatus.textContent = statusLabel;

      tr.append(tdChain, tdTicker, tdFee, tdChange, tdSpeed, tdStatus);
      tbody.appendChild(tr);
    }

    if (tbodyMobile) {
      const trMobile = document.createElement("tr");
      trMobile.classList.add("fee-row-mobile", `status-${statusClass}`);

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
      metricsTop.append("Estimated Tx Fee (USD/JPY) ", feeValueMobile, " · 24h ", changeValueMobile);

      const metricsBottom = document.createElement("div");
      metricsBottom.classList.add("metrics-bottom");
      const speedMobile = document.createElement("span");
      speedMobile.classList.add("speed-mobile");
      speedMobile.textContent = speedApprox;
      const statusMobile = document.createElement("span");
      statusMobile.classList.add("status-mobile", "status-cell", `status-${statusClass}`);
      statusMobile.textContent = statusLabel;
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
  const meta = normalizeMetaPayload(historyMeta);
  if (!meta) {
    freshnessEl.textContent = "Loading…";
    renderHealthBadge();
    return;
  }
  const age = typeof meta.ageSecOverall === "number" ? meta.ageSecOverall : null;
  freshnessEl.textContent = age == null ? "—" : formatAge(age);
  renderHealthBadge();
}

function renderHealthBadge() {
  const badgeEl = document.getElementById("healthBadge");
  if (!badgeEl) return;
  const meta = normalizeMetaPayload(historyMeta);
  renderHealthDetails(meta);
  if (!meta) {
    badgeEl.textContent = "Health: —";
    badgeEl.classList.remove("stale");
    return;
  }
  const nowTs = typeof meta.nowTs === "number" ? meta.nowTs : Math.floor(Date.now() / 1000);
  const lastWriteTs =
    resolveMetaTimestamp(meta, "lastWrittenAt", "lastWriteAt") ??
    resolveMetaTimestamp(meta, "latestTsOverall", "lastWriteAt");
  const lastOkTs = resolveMetaTimestamp(meta, "lastOkTs", "lastOkAt");
  const stale = meta.stale === true;
  const reason = typeof meta.staleReason === "string" ? meta.staleReason : null;
  badgeEl.classList.toggle("stale", stale);

  if (stale) {
    if (reason === "no_write") {
      badgeEl.textContent = "Health: STALE · no writes yet";
      return;
    }
    if (reason === "write_too_old") {
      const age = lastWriteTs != null ? formatAge(nowTs - lastWriteTs) : "—";
      badgeEl.textContent = `Health: STALE · last write ${age}`;
      return;
    }
    if (reason === "ok_too_old") {
      const age = lastOkTs != null ? formatAge(nowTs - lastOkTs) : "—";
      badgeEl.textContent = `Health: STALE · last ok ${age}`;
      return;
    }
    badgeEl.textContent = "Health: STALE";
    return;
  }

  const updatedAge = lastWriteTs != null ? formatAge(nowTs - lastWriteTs) : "—";
  let label = `Health: OK · updated ${updatedAge}`;
  const gapHours = typeof meta.maxGapHours24h === "number" ? meta.maxGapHours24h : null;
  if (gapHours != null && gapHours >= 6) {
    label += ` (gap ${Math.round(gapHours)}h)`;
  }
  badgeEl.textContent = label;
}

function setupHealthDetailsPopover() {
  const details = document.getElementById("healthDetails");
  if (!details) return;

  document.addEventListener("click", (event) => {
    if (!details.open) return;
    if (details.contains(event.target)) return;
    details.removeAttribute("open");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && details.open) {
      details.removeAttribute("open");
    }
  });
}

// ----- Lifecycle -----
async function loadSnapshotAndRender() {
  const updatedEl = document.getElementById("updated-label");
  if (updatedEl) {
    updatedEl.textContent = "Loading…";
  }
  pageState?.setState("loading", {
    title: "Loading...",
    message: "Fetching the latest snapshot.",
  });
  state.dataEmpty = false;
  try {
    const snapshot = await fetchFeeSnapshot();
    state.snapshot = snapshot;
    state.allRows = buildRowsFromSnapshot(snapshot);
    if (updatedEl) {
      updatedEl.textContent = formatUpdated(snapshot.generatedAt);
    }
    if (!state.allRows.length) {
      state.dataEmpty = true;
      renderTable([]);
      pageState?.setState("empty", {
        title: "No data yet",
        message: "History is still building or no rows matched. Try again later or loosen filters.",
        onRetry: loadSnapshotAndRender,
      });
    } else {
      pageState?.setState("ok");
      renderTable(getVisibleRows());
    }
    renderFreshness();
  } catch (err) {
    console.error(err);
    if (updatedEl) {
      updatedEl.textContent = "—";
    }
    state.snapshot = null;
    state.allRows = [];
    state.dataEmpty = false;
    renderTable([]);
    const normalized = typeof normalizeError === "function" ? normalizeError(err) : {
      title: "Request failed",
      message: err?.message || "Failed to load snapshot",
      details: err?.stack || "",
    };
    pageState?.setState("error", {
      title: normalized.title,
      message: normalized.message,
      details: normalized.details,
      onRetry: loadSnapshotAndRender,
    });
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
  uiControls.usdBtn = usdBtn;
  uiControls.jpyBtn = jpyBtn;

  if (usdBtn) {
    usdBtn.addEventListener("click", () => {
      state.currency = "usd";
      setUrlState({ currency: "usd" });
      syncCurrencyButtons();
      syncUrlState();
      renderTable(getVisibleRows());
    });
  }
  if (jpyBtn) {
    jpyBtn.addEventListener("click", () => {
      state.currency = "jpy";
      setUrlState({ currency: "jpy" });
      syncCurrencyButtons();
      syncUrlState();
      renderTable(getVisibleRows());
    });
  }

  syncCurrencyButtons();
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

const urlSync = window.CryptoFeeScopeStateSync;
let urlState = { ...URL_STATE_DEFAULTS };
let lastSyncedQuery = "";
let skipNextLocalSave = false;
let searchDebounceId = null;
const uiControls = {
  searchInput: null,
  statusSelect: null,
  sortSelect: null,
  usdBtn: null,
  jpyBtn: null,
};

function mapSortByToQuery(sortBy) {
  if (sortBy === "fee_asc") return { sort: "fee", dir: "asc" };
  if (sortBy === "fee_desc") return { sort: "fee", dir: "desc" };
  if (sortBy === "speed_asc") return { sort: "speed", dir: "asc" };
  if (sortBy === "speed_desc") return { sort: "speed", dir: "desc" };
  if (sortBy === "chain_asc") return { sort: "chain", dir: "asc" };
  if (sortBy === "chain_desc") return { sort: "chain", dir: "desc" };
  return { sort: null, dir: null };
}

function mapQueryToSortBy(sort, dir) {
  if (sort === "fee" && dir === "asc") return "fee_asc";
  if (sort === "fee" && dir === "desc") return "fee_desc";
  if (sort === "speed" && dir === "asc") return "speed_asc";
  if (sort === "speed" && dir === "desc") return "speed_desc";
  if (sort === "chain" && dir === "asc") return "chain_asc";
  if (sort === "chain" && dir === "desc") return "chain_desc";
  return "default";
}

function setUrlState(partial) {
  if (!urlSync) return;
  const normalized = urlSync.normalizeState(partial, URL_STATE_CONFIG);
  const next = { ...urlState };
  Object.keys(partial).forEach((key) => {
    if (normalized[key] !== undefined) {
      next[key] = normalized[key];
    } else if (key in URL_STATE_DEFAULTS) {
      next[key] = URL_STATE_DEFAULTS[key];
    }
  });
  urlState = { ...URL_STATE_DEFAULTS, ...next };
}

function applyUrlStateToUi(nextState) {
  state.searchQuery = nextState.q || "";
  state.currency = nextState.currency || "usd";
  state.sortBy = mapQueryToSortBy(nextState.sort, nextState.dir);
}

function syncUrlState() {
  if (!urlSync) return;
  const params = urlSync.serializeQuery(urlState, URL_STATE_DEFAULTS);
  const queryString = params.toString();
  const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
  const current = window.location.pathname + window.location.search;
  if (nextUrl !== current) {
    history.replaceState({}, "", nextUrl);
  }
  lastSyncedQuery = queryString;
  if (!skipNextLocalSave) {
    const compacted = urlSync.compactState(urlState, URL_STATE_DEFAULTS);
    urlSync.saveLocalState(compacted);
  }
  skipNextLocalSave = false;
}

function scheduleUrlSync() {
  if (searchDebounceId) window.clearTimeout(searchDebounceId);
  searchDebounceId = window.setTimeout(() => {
    searchDebounceId = null;
    syncUrlState();
  }, 300);
}

function initializeUrlState() {
  if (!urlSync) return;
  const params = new URLSearchParams(window.location.search);
  const hasUrlState = urlSync.hasAnyQueryKey(params);
  const urlParsed = hasUrlState ? urlSync.parseQuery(params, URL_STATE_CONFIG) : {};
  const localParsed = !hasUrlState ? urlSync.loadLocalState(URL_STATE_CONFIG) : {};
  urlState = urlSync.mergeState(URL_STATE_DEFAULTS, urlParsed, localParsed);
  applyUrlStateToUi(urlState);
  lastSyncedQuery = params.toString();
  skipNextLocalSave = !hasUrlState;
  syncUrlState();
}

function handlePopState() {
  if (!urlSync) return;
  const params = new URLSearchParams(window.location.search);
  const queryString = params.toString();
  if (queryString === lastSyncedQuery) return;
  const hasUrlState = urlSync.hasAnyQueryKey(params);
  const urlParsed = hasUrlState ? urlSync.parseQuery(params, URL_STATE_CONFIG) : {};
  const localParsed = !hasUrlState ? urlSync.loadLocalState(URL_STATE_CONFIG) : {};
  urlState = urlSync.mergeState(URL_STATE_DEFAULTS, urlParsed, localParsed);
  applyUrlStateToUi(urlState);
  syncTableControls();
  syncCurrencyButtons();
  renderTable(getVisibleRows());
  lastSyncedQuery = queryString;
}

function syncTableControls() {
  if (uiControls.searchInput) {
    uiControls.searchInput.value = state.searchQuery;
  }
  if (uiControls.statusSelect) {
    uiControls.statusSelect.value = VALID_STATUSES.includes(state.filterStatus) ? state.filterStatus : "all";
  }
  if (uiControls.sortSelect) {
    uiControls.sortSelect.value = VALID_SORTS.includes(state.sortBy) ? state.sortBy : "default";
  }
}

function syncCurrencyButtons() {
  const { usdBtn, jpyBtn } = uiControls;
  if (usdBtn) usdBtn.classList.toggle("active", state.currency === "usd");
  if (jpyBtn) jpyBtn.classList.toggle("active", state.currency === "jpy");
}

function bindTableControls() {
  const searchInput = document.getElementById("search");
  const statusSelect = document.getElementById("statusFilter");
  const sortSelect = document.getElementById("sortBy");

  uiControls.searchInput = searchInput;
  uiControls.statusSelect = statusSelect;
  uiControls.sortSelect = sortSelect;

  if (searchInput) {
    searchInput.value = state.searchQuery;
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      setUrlState({ q: state.searchQuery });
      scheduleUrlSync();
      renderTable(getVisibleRows());
    });
  }

  if (statusSelect) {
    statusSelect.value = VALID_STATUSES.includes(state.filterStatus) ? state.filterStatus : "all";
    statusSelect.addEventListener("change", () => {
      const value = statusSelect.value;
      state.filterStatus = VALID_STATUSES.includes(value) ? value : "all";
      renderTable(getVisibleRows());
    });
  }

  if (sortSelect) {
    sortSelect.value = VALID_SORTS.includes(state.sortBy) ? state.sortBy : "default";
    sortSelect.addEventListener("change", () => {
      const value = sortSelect.value;
      state.sortBy = VALID_SORTS.includes(value) ? value : "default";
      setUrlState(mapSortByToQuery(state.sortBy));
      syncUrlState();
      renderTable(getVisibleRows());
    });
  }
}

// ----- Init -----
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getInitialTheme());
  initializeUrlState();
  window.addEventListener("popstate", handlePopState);

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
  setupHealthDetailsPopover();
  loadSnapshotAndRender();
  fetchHistoryMeta();
  setInterval(loadSnapshotAndRender, 60_000);
  setInterval(fetchHistoryMeta, 60_000);
});
