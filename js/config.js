// All addresses below were verified onchain (HyperEVM, chain id 999).
window.CONFIG = {
  chainId: 999,
  token: {
    address: "0x9e86aF070E1B05a3E857b4d1E31dfd860Da245C0",
    symbol: "REROLL",
    decimals: 8,
    deployBlock: 49001629,
  },
  pool: {
    address: "0xc43d5f0077a9da3aa57314b52f1c1cb68997dd35",
    dex: "Project X",
    quote: { address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", symbol: "USDC", decimals: 6 },
  },
  burnAddress: "0x000000000000000000000000000000000000dead",

  // Known wallets, identified from the token's transfer history.
  labels: {
    "0x658ba124b227f2dec2cd1a7b8216685f9bbcb2fb": { name: "Treasury (deployer)", kind: "treasury" },
    "0x13ca14a6a4f8b2d010665b25a741771792b3405e": { name: "Reroll platform", kind: "platform" },
    "0xc43d5f0077a9da3aa57314b52f1c1cb68997dd35": { name: "Project X LP", kind: "lp" },
    "0x000000000000000000000000000000000000dead": { name: "Burn address", kind: "burn" },
  },

  // Public RPCs that allow browser (CORS) requests. Requests rotate across them.
  rpcs: [
    "https://rpc.hyperliquid.xyz/evm",
    "https://rpc.hypurrscan.io",
    "https://hyperliquid-json-rpc.stakely.io",
    "https://999.rpc.thirdweb.com",
  ],
  logRange: 1000,

  explorer: "https://hyperevmscan.io",
  dexscreener: "https://dexscreener.com/hyperevm/0xc43d5f0077a9da3aa57314b52f1c1cb68997dd35",
  api: {
    dexscreener: "https://api.dexscreener.com/latest/dex/pairs/hyperevm/0xc43d5f0077a9da3aa57314b52f1c1cb68997dd35",
    // GeckoTerminal pool endpoints via the server's cached proxy (api/gecko.js).
    gecko: "/api/gecko",
    // Optional same-origin proxy for Reroll's own supply endpoint (api.reroll.gg blocks
    // other origins). See api/reroll-supply.js. The panel stays hidden if this fails.
    rerollSupply: "/api/reroll-supply",
  },

  refresh: {
    market: 15000, // DexScreener
    trades: 30000, // GeckoTerminal (30 req/min limit)
    chain: 6000, // new blocks / transfers
    verify: 60000, // re-check balances with balanceOf
  },
};
