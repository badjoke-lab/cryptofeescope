import { validateSnapshot } from "../workers/history-writer/src/validateSnapshot.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sampleA = {
  feeUSD: NaN,
  feeJPY: 1200,
  speedSec: Infinity,
  priceChange24hPct: 30000,
  status: "ok",
};

const resultA = validateSnapshot("sample-chain", sampleA);
assert(resultA.cleaned.feeUsd === null, "feeUSD should be null for NaN");
assert(resultA.cleaned.speedSec === null, "speedSec should be null for Infinity");
assert(resultA.cleaned.priceChange24hPct === null, "priceChange24hPct should be null for >20000% outlier");
assert(resultA.invalidFields.includes("feeUSD"), "feeUSD should be invalid");
assert(resultA.invalidFields.includes("speedSec"), "speedSec should be invalid");
assert(resultA.invalidFields.includes("priceChange24hPct"), "priceChange24hPct should be invalid");

const sampleB = {
  feeUSD: 12.5,
  speedSec: 45,
  priceChange24hPct: 6000,
  status: "ok",
};

const resultB = validateSnapshot("sample-chain", sampleB);
assert(resultB.cleaned.feeUsd === 12.5, "feeUSD should stay valid");
assert(resultB.cleaned.speedSec === 45, "speedSec should stay valid");
assert(resultB.cleaned.priceChange24hPct === 6000, "priceChange24hPct should stay valid");
assert(resultB.warnings.includes("priceChange24hPct"), "priceChange24hPct should trigger warning");

console.log("sanity_check_sample passed");
