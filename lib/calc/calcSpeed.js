function btcSpeed(candidate) {
  const fee = candidate?.satPerVbyte || candidate?.gasPriceGwei;
  if (!fee) return 300;
  if (fee >= 60) return 30;
  if (fee >= 30) return 120;
  return 300;
}

function evmSpeed() {
  return 120;
}

function l2Speed(candidate) {
  const gp = candidate?.gasPriceGwei;
  if (!gp) return 45;
  if (gp > 1) return 15;
  return 45;
}

function solSpeed() {
  return 4;
}

function xrpSpeed() {
  return 4;
}

function calcSpeed(chainKey, candidate) {
  if (chainKey === 'btc') return btcSpeed(candidate);
  if (chainKey === 'sol') return solSpeed(candidate);
  if (chainKey === 'xrp') return xrpSpeed(candidate);
  if (chainKey === 'arb') return 45;
  if (['op', 'base'].includes(chainKey)) return l2Speed(candidate);
  return evmSpeed(candidate);
}

module.exports = { calcSpeed };
