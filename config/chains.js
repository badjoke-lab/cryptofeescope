const ranges = require('./ranges');

module.exports = {
  btc: {
    key: 'btc',
    symbol: 'BTC',
    type: 'btc',
    vBytes: 140,
    range: ranges.btc,
  },
  eth: {
    key: 'eth',
    symbol: 'ETH',
    type: 'evm',
    gasLimit: 65000,
    range: ranges.eth,
    rpc: [
      'https://rpc.ankr.com/eth',
      'https://ethereum-rpc.publicnode.com',
    ],
    etherscan: 'https://api.etherscan.io/api?module=gastracker&action=gasoracle',
  },
  bsc: {
    key: 'bsc',
    symbol: 'BNB',
    type: 'evm',
    gasLimit: 65000,
    range: ranges.bsc,
    rpc: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-rpc.publicnode.com',
    ],
    etherscan: 'https://api.bscscan.com/api?module=gastracker&action=gasoracle',
  },
  polygon: {
    key: 'polygon',
    symbol: 'MATIC',
    type: 'evm',
    gasLimit: 65000,
    range: ranges.polygon,
    rpc: [
      'https://polygon-rpc.com',
      'https://polygon-bor.publicnode.com',
    ],
    etherscan: 'https://api.polygonscan.com/api?module=gastracker&action=gasoracle',
  },
  avax: {
    key: 'avax',
    symbol: 'AVAX',
    type: 'evm',
    gasLimit: 65000,
    range: ranges.avax,
    rpc: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche-c-chain.publicnode.com',
    ],
    etherscan: 'https://api.snowtrace.io/api?module=gastracker&action=gasoracle',
  },
  sol: {
    key: 'sol',
    symbol: 'SOL',
    type: 'sol',
    range: ranges.sol,
    rpc: [
      'https://api.mainnet-beta.solana.com',
      'https://rpc.ankr.com/solana',
    ],
  },
  xrp: {
    key: 'xrp',
    symbol: 'XRP',
    type: 'xrp',
    range: ranges.xrp,
    rpc: 'https://s1.ripple.com:51234',
  },
  arb: {
    key: 'arb',
    symbol: 'ETH',
    type: 'l2',
    gasLimitL2: 65000,
    l1DataGas: 30000,
    range: ranges.arb,
    rpc: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one.publicnode.com',
    ],
  },
  op: {
    key: 'op',
    symbol: 'ETH',
    type: 'l2',
    gasLimitL2: 65000,
    l1DataGas: 30000,
    range: ranges.op,
    rpc: [
      'https://mainnet.optimism.io',
      'https://optimism-rpc.publicnode.com',
    ],
  },
  base: {
    key: 'base',
    symbol: 'ETH',
    type: 'l2',
    gasLimitL2: 65000,
    l1DataGas: 30000,
    range: ranges.base,
    rpc: [
      'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
    ],
  },
};
