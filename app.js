// CryptoFeeScope front-end
// - /api/snapshot から最新スナップショットを取得
// - 取得に失敗してもアプリ全体が落ちないように防御的に実装

const CHAIN_META = [
  { id: "bitcoin",  name: "Bitcoin (L1)",  ticker: "BTC" },
  { id: "ethereum", name: "Ethereum (L1)", ticker: "ETH" },
  { id: "arbitrum", name: "Arbitrum One",  ticker: "ARB" },
  { id: "optimism", name: "Optimism",      ticker: "OP" },
  { id: "solana",   name: "Solana",        ticker: "SOL" },
];

const SNAPSHOT_ENDPOINT = "/api/snapshot";

// DOM ヘルパー（IDがなくても動くようにかなり甘めに取る）
function pickTableBody() {
  // id="fee-table-body" があれば最優先
  let el = document.getElementById("fee-table-body");
  if (el) return el;
  // data-role="fee-table-body"
  el = document.querySelector("tbody[data-role='fee-table-body']");
  if (el) return el;
  // 最後の手段：ページ内で最初に見つかった tbody
  return document.querySelector("tbody");
}

function pickRefreshButton() {
  return (
    document.querySelector("[data-role='refresh-button']") ||
    document.getElementById("refreshButton") ||
    document.querySelector("button#refresh") ||
    document.querySelector("button.refresh-button") ||
    null
  );
}

function pickUpdatedLabel() {
  return (
    document.querySelector("[data-role='updated-label']") ||
    document.getElementById("updatedLabel") ||
    document.getElementById("updatedAt") ||
    null
  );
}

// 表示用フォーマッタ
function formatFeeUSD(value) {
  if (value == null || isNaN(value)) return "-";
  const v = Number(value);
  if (v <= 0) return "-";

  if (v < 0.000001) return "< $0.000001";
  if (v < 0.0001)   return "$" + v.toFixed(6);
  if (v < 0.01)     return "$" + v.toFixed(4);
  if (v < 1)        return "$" + v.toFixed(3);
  if (v < 100)      return "$" + v.toFixed(2);
  return "$" + v.toFixed(0);
}

function formatSpeedSec(seconds) {
  if (seconds == null || isNaN(seconds)) return "-";
  const s = Number(seconds);
  if (s < 1) return s.toFixed(1) + " sec";
  if (s < 60) return Math.round(s) + " sec";
  const m = Math.round(s / 60);
  return m + " min";
}

function formatStatus(status) {
  if (!status) return "-";
  // snapshot の status は "fast" / "avg" / "slow" を想定
  const s = String(status).toLowerCase();
  if (s === "fast") return "Fast";
  if (s === "avg" || s === "average") return "Average";
  if (s === "slow") return "Slow";
  return status;
}

function formatUpdated(ts) {
  if (!ts) return "-";
  // snapshot の updated は UNIX ms かもしれないので両対応
  let date;
  if (typeof ts === "number") {
    date = new Date(ts);
  } else if (typeof ts === "string") {
    const n = Number(ts);
    if (!isNaN(n) && ts.length > 10) {
      date = new Date(n);
    } else {
      date = new Date(ts);
    }
  } else {
    return "-";
  }
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString();
}

// snapshot JSON をテーブル用の行配列に変換
function normalizeSnapshot(snapshotJson) {
  if (!snapshotJson || typeof snapshotJson !== "object") return [];

  const rows = [];

  for (const meta of CHAIN_META) {
    const raw = snapshotJson[meta.id];
    if (!raw) continue;

    rows.push({
      id: meta.id,
      name: meta.name,
      ticker: meta.ticker,
      feeUSD: raw.feeUSD,
      speedSec: raw.speedSec,
      status: raw.status,
      updated: raw.updated,
    });
  }

  // 何も取れなかった場合、全部舐める（想定外のチェーンID用）
  if (rows.length === 0) {
    for (const [id, raw] of Object.entries(snapshotJson)) {
      rows.push({
        id,
        name: id,
        ticker: (CHAIN_META.find((c) => c.id === id) || {}).ticker || id.toUpperCase().slice(0, 4),
        feeUSD: raw.feeUSD,
        speedSec: raw.speedSec,
        status: raw.status,
        updated: raw.updated,
      });
    }
  }

  return rows;
}

// テーブル描画
function renderTable(rows) {
  const tbody = pickTableBody();
  if (!tbody) {
    console.warn("[CryptoFeeScope] tbody が見つからないため、テーブルを描画できません。");
    return;
  }

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding: 24px; text-align: center; color: #888;">
          No data. Try "Refresh".
        </td>
      </tr>
    `;
    return;
  }

  const html = rows
    .map((row) => {
      return `
        <tr>
          <td>${row.name}</td>
          <td>${row.ticker}</td>
          <td>${formatFeeUSD(row.feeUSD)}</td>
          <td>${formatSpeedSec(row.speedSec)}</td>
          <td>${formatStatus(row.status)}</td>
          <td>${formatUpdated(row.updated)}</td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}

// Snapshot 取得 → テーブル更新
async function loadSnapshotAndRender() {
  const updatedLabel = pickUpdatedLabel();
  if (updatedLabel) {
    updatedLabel.textContent = "Loading…";
  }

  try {
    const res = await fetch(SNAPSHOT_ENDPOINT, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    const rows = normalizeSnapshot(json);
    renderTable(rows);

    if (updatedLabel) {
      const now = new Date();
      updatedLabel.textContent = `Updated: ${now.toLocaleTimeString()}`;
    }

    console.log("[CryptoFeeScope] snapshot loaded", json);
  } catch (err) {
    console.error("[CryptoFeeScope] Failed to load snapshot", err);
    renderTable([]);

    if (updatedLabel) {
      updatedLabel.textContent = "Error loading data";
    }
  }
}

// 初期化
document.addEventListener("DOMContentLoaded", () => {
  // 初回ロード
  loadSnapshotAndRender();

  // Refresh ボタンがあれば紐付け
  const btn = pickRefreshButton();
  if (btn) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      loadSnapshotAndRender();
    });
  }
});
