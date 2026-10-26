# REROLL Onchain Dashboard

Live dashboard for the REROLL token (reroll.gg) on HyperEVM, styled to match the Reroll site.

## Run locally

```bash
npm start        # http://localhost:5199
```

No dependencies — Node 18+ only. (Opening `index.html` directly from disk will not work;
browsers block `fetch` on `file://`.)

## Where every number comes from

| Figure | Source | How |
|---|---|---|
| Total supply | **Chain** | `totalSupply()` on the token contract |
| Burned | **Chain** | `balanceOf(0x…dEaD)` |
| Treasury / Platform / LP balances | **Chain** | `balanceOf` on each labelled wallet |
| Public wallets | **Chain** | total supply − all labelled wallets |
| Holders + top holders | **Chain** | Every `Transfer` event replayed from the deploy block, then the top 50 re-verified with `balanceOf` every 60s |
| Liquidity | **Chain** + price | REROLL and USDC held by the pool contract × price |
| Top 10 wallets | **Chain** | Share of supply in the 10 largest wallets, excluding treasury, platform, LP and burn |
| All-time high | GeckoTerminal | Highest hourly candle since launch (or the live price, if higher) |
| Live transfers | **Chain** | New `Transfer` logs polled every 6s |
| Price | **Chain** | Read from the pool contract's `slot0()` every 6s |
| Market cap / FDV | **Chain** + price | price × 1B supply, the same basis CoinGecko, DexScreener and Reroll use |
| % change, volume, buys/sells | GeckoTerminal (DexScreener fallback) | refreshed every 15s |
| Price chart, recent trades | GeckoTerminal | refreshed every 60s / 30s |
| Circulating, staked | Reroll API (via `/api/reroll-supply`) | Staking is held in Reroll's custody, so it is **not** visible onchain; shown as "Reported by Reroll" |

## Key addresses (HyperEVM, chain 999)

| | Address |
|---|---|
| REROLL token (8 decimals, 1B supply) | `0x9e86aF070E1B05a3E857b4d1E31dfd860Da245C0` |
| Project X REROLL/USDC 1% pool | `0xc43d5f0077a9da3aa57314b52f1c1cb68997dd35` |
| Treasury (deployer, received the 1B mint) | `0x658ba124b227f2dec2cd1a7b8216685f9bbcb2fb` |
| Reroll platform wallet (user deposits / withdrawals) | `0x13ca14a6a4f8b2d010665b25a741771792b3405e` |
| Burn | `0x000000000000000000000000000000000000dEaD` |

Labels live in `js/config.js`. Add new wallets there (e.g. if Reroll announces a new vault).

## Holder snapshot

`data/snapshot.json` stores every balance at a known block, so visitors only replay the
blocks since then. The server refreshes it automatically every 10 minutes. To refresh by hand:

```bash
npm run snapshot
```

If the snapshot is missing, the page falls back to a full scan from the deploy block (slower, still exact).

## Deploy (Railway)

1. Push this folder to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway detects Node and runs `npm start`. No environment variables are needed (`PORT` is set by Railway).
4. **Settings → Networking → Generate Domain** to get a public URL.
5. Optional: **Settings → Healthcheck path** = `/health`.

The server (`scripts/serve.mjs`) serves the page, proxies Reroll's supply endpoint at
`/api/reroll-supply`, and keeps the holder snapshot fresh. Only `index.html`, `css/`, `js/`,
`assets/` and `data/snapshot.json` are publicly served.

## Files

```
index.html            page
css/styles.css        theme (Reroll palette)
js/config.js          addresses, RPCs, refresh rates
js/chain.js           HyperEVM RPC client (rotation, batching, log scanning)
js/app.js             data loading + rendering
api/reroll-supply.js  proxy for Reroll's supply endpoint
scripts/snapshot.mjs  rebuilds data/snapshot.json from chain
scripts/serve.mjs     server (Railway + local)
```
