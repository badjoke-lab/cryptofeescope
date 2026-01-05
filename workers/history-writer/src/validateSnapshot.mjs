const MAX_FEE_USD = 100000;
const MAX_SPEED_SEC = 604800;
const MAX_PRICE_CHANGE_PCT = 20000;
const WARN_PRICE_CHANGE_PCT = 5000;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeFee(value, max) {
  if (!isFiniteNumber(value)) return null;
  if (value < 0) return null;
  if (typeof max === "number" && value > max) return null;
  return value;
}

function sanitizeStatus(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 24 ? trimmed : null;
}

function validateFeeUsd(value, invalidFields) {
  if (value == null) {
    invalidFields.push("feeUSD");
    return null;
  }
  if (!isFiniteNumber(value) || value < 0 || value > MAX_FEE_USD) {
    invalidFields.push("feeUSD");
    return null;
  }
  return value;
}

function validateSpeedSec(value, invalidFields) {
  if (value == null) {
    invalidFields.push("speedSec");
    return null;
  }
  if (!isFiniteNumber(value) || value <= 0 || value > MAX_SPEED_SEC) {
    invalidFields.push("speedSec");
    return null;
  }
  return value;
}

function validatePriceChangePct(value, invalidFields, warnings) {
  if (value == null) return null;
  if (!isFiniteNumber(value) || Math.abs(value) > MAX_PRICE_CHANGE_PCT) {
    invalidFields.push("priceChange24hPct");
    return null;
  }
  if (Math.abs(value) > WARN_PRICE_CHANGE_PCT) {
    warnings.push("priceChange24hPct");
  }
  return value;
}

export function validateSnapshot(chainKey, payload) {
  const invalidFields = [];
  const warnings = [];
  const cleaned = {
    chain: chainKey,
    feeUsd: validateFeeUsd(payload?.feeUSD, invalidFields),
    feeJpy: sanitizeFee(payload?.feeJPY, 150000),
    speedSec: validateSpeedSec(payload?.speedSec, invalidFields),
    status: sanitizeStatus(payload?.status),
    priceChange24hPct: null,
  };

  if (payload && Object.prototype.hasOwnProperty.call(payload, "priceChange24hPct")) {
    cleaned.priceChange24hPct = validatePriceChangePct(
      payload.priceChange24hPct,
      invalidFields,
      warnings
    );
  }

  return { cleaned, invalidFields, warnings };
}

export const __TESTING__ = {
  isFiniteNumber,
  sanitizeFee,
  sanitizeStatus,
  validateFeeUsd,
  validateSpeedSec,
  validatePriceChangePct,
};
