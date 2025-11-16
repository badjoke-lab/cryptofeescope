// api/snapshot.js

/**
 * CryptoFeeScope Phase2 用 /api/snapshot モック実装（Node/JS版）
 * ここではまだ外部APIは叩かず、固定値だけ返す。
 * 後でこの中身を実データに差し替える。
 */
export default async function handler(req, res) {
  const now = Date.now();

  const data = {
    bitcoin: {
      feeUSD: 1.95,
      speedSec: 600, // 約10分
      status: "slow",
      updated: now,
      tieredSpeed: false,
    },
    ethereum: {
      feeUSD: 0.82, // Standard Tier
      speedSec: 45, // 30–60sec の代表値
      status: "avg",
      updated: now,
      tieredSpeed: true,
      tiers: [
        {
          tier: "low",
          gasPrice: 9,
          gasUnit: "gwei",
          feeUSD: 0.55,
          speedMinSec: 180,
          speedMaxSec: 300,
        },
        {
          tier: "standard",
          gasPrice: 14,
          gasUnit: "gwei",
          feeUSD: 0.82,
          speedMinSec: 30,
          speedMaxSec: 60,
        },
        {
          tier: "high",
          gasPrice: 20,
          gasUnit: "gwei",
          feeUSD: 1.1,
          speedMinSec: 5,
          speedMaxSec: 20,
        },
      ],
    },
    arbitrum: {
      feeUSD: 0.02,
      speedSec: 8,
      status: "fast",
      updated: now,
      tieredSpeed: false,
    },
    optimism: {
      feeUSD: 0.03,
      speedSec: 10,
      status: "fast",
      updated: now,
      tieredSpeed: false,
    },
    solana: {
      feeUSD: 0.0005,
      speedSec: 3,
      status: "fast",
      updated: now,
      tieredSpeed: false,
    },
  };

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json(data);
}
