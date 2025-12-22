// feeFormat.js

// 対応通貨：Phase1 と同じ USD / JPY / EUR 想定
const SUPPORTED_CURRENCIES = ["USD", "JPY", "EUR"];

function getCurrencySymbol(currency) {
  switch (currency) {
    case "USD":
      return "$";
    case "JPY":
      return "¥";
    case "EUR":
      return "€";
    default:
      return "";
  }
}

function trimTrailingZeros(str) {
  return str.includes(".") ? str.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : str;
}

// Number → 科学表記なしの素の10進文字列
function toPlainString(num) {
  if (!isFinite(num)) return String(num);
  var str = num.toString();
  if (!/e/i.test(str)) return str;

  var parts = str.split("e");
  var base = parts[0];
  var exp = parseInt(parts[1], 10);

  var isNeg = num < 0;
  var absBase = Math.abs(parseFloat(base));
  var baseStr = absBase.toString();
  var digits = baseStr.replace(".", "");
  var decimalPos = baseStr.indexOf(".") === -1 ? digits.length : baseStr.indexOf(".");

  var newPos = decimalPos + exp;

  if (newPos <= 0) {
    digits = "0".repeat(1 - newPos) + digits;
    newPos = 1;
  } else if (newPos >= digits.length) {
    digits = digits + "0".repeat(newPos - digits.length);
  }

  var intPart = digits.slice(0, newPos);
  var decPart = digits.slice(newPos).replace(/0+$/, "");
  var result = decPart.length ? intPart + "." + decPart : intPart;
  return isNeg ? "-" + result : result;
}

function toPlainNumberString(value) {
  return toPlainString(Number(value));
}

function formatFeeDisplayParts(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { display: "—", displayText: "—", exact: "", exactText: "", raw: "" };
  }

  const code = typeof currency === "string" ? currency.toUpperCase() : "USD";
  const symbol = getCurrencySymbol(code);
  const abs = Math.abs(num);

  const thresholdMap = { USD: 0.001, JPY: 0.1 };
  const threshold = thresholdMap[code] || thresholdMap.USD;
  const exact = toPlainNumberString(num);

  if (num > 0 && num < threshold) {
    const display = `<${symbol}${toPlainNumberString(threshold)}`;
    return {
      display,
      displayText: display,
      exact,
      exactText: exact,
      raw: `${symbol}${exact}`,
      symbol,
      currency: code,
    };
  }

  let digits;
  if (abs < 0.00001) digits = 6;
  else if (abs < 0.01) digits = 5;
  else if (abs < 0.1) digits = 4;
  else if (abs < 1) digits = 3;
  else digits = 2;

  const rounded = trimTrailingZeros(num.toFixed(digits));
  const display = `${symbol}${rounded}`;
  return {
    display,
    displayText: display,
    exact,
    exactText: exact,
    raw: `${symbol}${exact}`,
    symbol,
    currency: code,
  };
}

function formatFeeUSD(value, opts) {
  return formatFeeDisplayParts(value, (opts && opts.currency) || "USD");
}

function formatFeeJPY(value, opts) {
  return formatFeeDisplayParts(value, (opts && opts.currency) || "JPY");
}

function formatFeePair(values, opts) {
  const currency = (opts && opts.currency) || (opts && opts.currencyCode) || "USD";
  const code = typeof currency === "string" ? currency.toUpperCase() : "USD";
  if (code === "JPY") {
    return formatFeeJPY(values && values.jpy != null ? values.jpy : values?.feeJPY, { currency: "JPY" });
  }
  return formatFeeUSD(values && values.usd != null ? values.usd : values?.feeUSD, { currency: "USD" });
}

/**
 * テーブル本体に表示する省略済みの Fee 表記
 */
function formatFeeDisplay(feeUSD, currency, fxRate) {
  fxRate = fxRate || 1;
  currency = currency || "USD";
  var feeInCurrency = feeUSD * fxRate;
  var symbol = getCurrencySymbol(currency);

  if (feeInCurrency > 0 && feeInCurrency < 0.001) {
    return "< " + symbol + "0.001";
  }

  if (feeInCurrency < 1000) {
    var rounded = Math.round(feeInCurrency * 1000) / 1000;
    var str = rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    return symbol + str;
  }

  if (feeInCurrency < 1000000) {
    var k = feeInCurrency / 1000;
    var roundedK = Math.round(k * 10) / 10;
    return symbol + roundedK.toFixed(1) + "k";
  }

  var m = feeInCurrency / 1000000;
  var roundedM = Math.round(m * 10) / 10;
  return symbol + roundedM.toFixed(1) + "m";
}

/**
 * Shared home/stats formatter for displaying fees with consistent precision.
 * - < 0.00001 -> 6 decimals
 * - < 0.01 -> 5 decimals
 * - < 0.1 -> 4 decimals
 * - < 1 -> 3 decimals
 * - otherwise 2 decimals
 * - returns "—" for null/NaN
 */
function formatFeeWithPrecision(value, currency) {
  return formatFeeDisplayParts(value, currency).display;
}

/**
 * ポップアップに表示する詳細情報
 * - exactLabel: 完全な値
 * - zeroCountLabel: 0.0…xx 形式（必要なときだけ）
 */
function buildFeeTooltipInfo(feeUSD, currency, fxRate) {
  fxRate = fxRate || 1;
  currency = currency || "USD";
  var feeInCurrency = feeUSD * fxRate;
  var symbol = getCurrencySymbol(currency);

  var exactLabel = symbol + toPlainString(feeInCurrency) + " " + currency;

  if (feeInCurrency <= 0 || feeInCurrency >= 0.1) {
    return { exactLabel: exactLabel };
  }

  var asString = toPlainString(feeInCurrency);
  var match = asString.match(/^0\.0+(.*)$/);
  if (!match) {
    return { exactLabel: exactLabel };
  }

  var rest = match[1]; // 最初の非ゼロから先
  var zerosMatch = asString.split(".")[1].match(/^0+/);
  var zeroCount = zerosMatch ? zerosMatch[0].length : 0;

  var dots = "…".repeat(Math.min(zeroCount, 6));
  var zeroCountLabel =
    "Zeros: " + zeroCount + " → " + symbol + "0.0" + dots + rest;

  return {
    exactLabel: exactLabel,
    zeroCountLabel: zeroCountLabel,
  };
}

function prefersInlineRaw() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
  return window.innerWidth <= 640;
}

function ensureInlineRawContainer(el) {
  if (!el) return null;
  const parent = el.closest && el.closest(".fee-cell, .cell-mobile-right, .metrics-top") || el.parentElement;
  if (!parent) return null;
  let inline = parent.querySelector && parent.querySelector(".fee-inline-raw");
  if (!inline) {
    inline = document.createElement("div");
    inline.className = "fee-inline-raw";
    parent.appendChild(inline);
  }
  return inline;
}

function bindRawValueDisclosure(el) {
  if (!el || el.dataset.rawBound === "true" || !el.dataset.rawValue) return;
  const handler = () => {
    const raw = el.dataset.rawValue;
    if (!raw) return;

    if (prefersInlineRaw()) {
      const inline = ensureInlineRawContainer(el);
      if (inline) {
        inline.textContent = `Exact: ${raw}`;
        inline.classList.add("visible");
      }
      return;
    }

    const original = el.dataset.displayValue || el.textContent;
    el.textContent = raw;
    if (el.dataset.rawTimer) {
      clearTimeout(Number(el.dataset.rawTimer));
    }
    const id = setTimeout(() => {
      el.textContent = original;
      el.dataset.rawTimer = "";
    }, 1500);
    el.dataset.rawTimer = String(id);
  };
  el.addEventListener("click", handler);
  el.addEventListener("touchstart", handler, { passive: true });
  el.dataset.rawBound = "true";
}

function bindRawValueDisclosureAll(scope) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  scope.querySelectorAll("[data-raw-value]").forEach(bindRawValueDisclosure);
}

function renderFeeValue(el, parts, displayText) {
  if (!el || !parts) return;
  const text = displayText ?? parts.display ?? parts.displayText ?? "—";
  const exact = parts.exact ?? parts.exactText ?? "";
  const exactLabel = parts.raw || (parts.symbol ? `${parts.symbol}${exact}` : exact);

  el.textContent = "";
  const valueEl = document.createElement("span");
  valueEl.className = "fee-val";
  valueEl.textContent = text;

  if (exact) {
    valueEl.title = `Exact: ${exactLabel}`;
    valueEl.setAttribute("role", "button");
    valueEl.setAttribute("tabindex", "0");
    valueEl.setAttribute("aria-expanded", "false");
    valueEl.dataset.exactValue = exactLabel;
  }

  el.appendChild(valueEl);

  if (!exact) return;

  const inline = document.createElement("div");
  inline.className = "fee-exact";
  inline.textContent = `Exact: ${exactLabel}`;
  inline.hidden = true;
  el.appendChild(inline);

  const toggle = () => {
    const willShow = inline.hidden;
    inline.hidden = !willShow;
    inline.classList.toggle("visible", willShow);
    valueEl.setAttribute("aria-expanded", willShow ? "true" : "false");
  };

  const handleKey = (evt) => {
    if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      toggle();
    }
  };

  valueEl.addEventListener("click", toggle);
  valueEl.addEventListener("touchstart", toggle, { passive: true });
  valueEl.addEventListener("keydown", handleKey);
}

if (typeof module !== "undefined") {
  module.exports = {
    formatFeeUSD,
    formatFeeJPY,
    formatFeePair,
    formatFeeDisplayParts,
    trimTrailingZeros,
    renderFeeValue,
  };
}
