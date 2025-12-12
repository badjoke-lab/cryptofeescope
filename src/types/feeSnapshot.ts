export type FeeTier = {
  label: string;
  feeUSD: number;
  feeJPY: number;
};

export type ChainSnapshot = {
  label: string;
  feeUSD: number;
  feeJPY: number;
  speedSec: number;
  status: string;
  updated: string;
  native: {
    amount: number;
    symbol: string;
  };
  tiers: FeeTier[];
  source: {
    price: {
      provider: string;
      id: string;
    };
  };
};

export type FeeSnapshot = {
  generatedAt: string;
  vsCurrencies: string[];
  chains: Record<string, ChainSnapshot>;
};
