# Dev notes

## Demo snapshot生成とフロント確認手順
1. `export COINGECKO_API_KEY="..."`
2. `node scripts/generate_fee_snapshot_demo.js > fee_snapshot_demo.json`
3. `mv fee_snapshot_demo.json public/data/fee_snapshot_demo.json`
4. `npm run dev`（または `pnpm dev` 等でフロントを起動）

ブラウザから CryptoFeeScope を開き、BTC / ETH / BNB / SOL / TRX / AVAX / XRP / Arbitrum / Optimism の表示手数料（USD/JPY）が `public/data/fee_snapshot_demo.json` と一致することを確認してください。
