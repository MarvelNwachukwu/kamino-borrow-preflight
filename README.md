# Kamino borrow preflight

A read-only TypeScript CLI that writes a standalone [HTML report](./report.html). The [screenshot](./report.png) shows a real Main-market snapshot and two positions. A CLI and static report avoid a server, browser wallet code, and transaction dependencies. This is an example, not a borrow approval.

**READ ONLY: cannot sign or submit.** No wallet connection, key, transaction, or instruction is used.

## Run

```bash
npm ci
npm run build
npm run preflight -- --reserve USDC --amount 10
npm run preflight -- --reserve USDC --amount 10 --wallet EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY
```

`--wallet` is an optional public wallet address. `--market` defaults to Kamino Main (`7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`). `--reserve` accepts a symbol or reserve address. On Main, `USDC` means the specific reserve `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`, matching [Kamino's SDK example constants](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/utils/constants.ts). Other ambiguous symbols require an address. `--html other-report.html` changes the output path. `SOLANA_RPC_URL` defaults to `https://api.mainnet-beta.solana.com`; public RPC rate limits can require a separate public RPC. No API key is required by this example.

The CLI prints JSON and overwrites `report.html` after a successful read. No wallet or no existing obligation means a reserve snapshot only, not an LTV or eligibility decision. For wallets with several obligations it reports each independently. It does not aggregate positions or choose an obligation.

## Observed mainnet run

Command: `npm run preflight -- --reserve USDC --amount 10 --wallet EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY`

Recorded **2026-10-20T20:33:33.118Z**, slot **459364099**, from the default public mainnet RPC. The example wallet is published in [Kamino's user-obligation documentation](https://kamino.com/docs/build/developers/borrow/data/user-position-data.md). These are time-sensitive observations, not current quotes.

```json
{
  "timestamp": "2026-10-20T20:33:33.118Z",
  "slot": "459364099",
  "market": "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  "wallet": "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY",
  "request": { "amount": "10", "amountBaseUnits": "10000000" },
  "reserve": {
    "symbol": "USDC",
    "address": "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
    "status": "Active",
    "availableTokens": "10713063.77",
    "borrowedTokens": "123091717.77",
    "remainingBorrowCapTokens": "576908282.23",
    "utilizationPercent": "92.19",
    "borrowApyPercent": "6.02"
  },
  "positions": [
    {
      "obligation": "5Rvm48nSVMsqmNJovS4kVAWUS6HX9jRiG3UsPq5VsyPV",
      "current": { "ltvPercent": "0.00", "borrowLimitUsd": "17.46", "liquidationThresholdPercent": "73.00", "liquidationLimitUsd": "19.61", "weightedDebtUsd": "0.00" },
      "after": { "ltvPercent": "37.22", "borrowLimitUsd": "17.46", "liquidationThresholdPercent": "73.00", "liquidationLimitUsd": "19.61", "weightedDebtUsd": "10.00" },
      "exceedsBorrowLimit": false,
      "reachesLiquidationThreshold": false,
      "preflight": "within displayed limits"
    },
    {
      "obligation": "GSQ5pY7D78iVyzrw8cSnzax6NiN9osvPEKF1N6UCogZA",
      "current": { "ltvPercent": "42.47", "borrowLimitUsd": "3.80", "liquidationThresholdPercent": "80.00", "liquidationLimitUsd": "4.11", "weightedDebtUsd": "2.18" },
      "after": { "ltvPercent": "241.72", "borrowLimitUsd": "3.80", "liquidationThresholdPercent": "80.00", "liquidationLimitUsd": "4.11", "weightedDebtUsd": "12.42" },
      "exceedsBorrowLimit": true,
      "reachesLiquidationThreshold": true,
      "preflight": "blocked by displayed limits"
    }
  ]
}
```

This is an excerpt of the actual JSON output. The first obligation stays below its displayed limits for this amount. The second would exceed its borrow limit and reach its liquidation threshold. See [report.html](./report.html) for the full snapshot. Build check: `npm run build` passed.

## Source of each number and limits

- The [Kamino SDK](https://github.com/Kamino-Finance/klend-sdk) loads market, reserves, live obligation state, interest projection, `getEstimatedUtilizationRatio`, `totalBorrowAPY`, and `refreshedStats` for current LTV, borrow limit, liquidation threshold and borrow-factor-adjusted debt. It also computes post-borrow stats with `getSimulatedObligationStats({ action: 'borrow' })`. APY excludes separate farm rewards.
- Local arithmetic converts base units to token units, checks exact token precision, subtracts estimated borrowed amount from the reserve cap, formats decimals for display, and compares projected weighted debt against the SDK limits. Decisions use unrounded SDK decimal values. The HTML and JSON round displayed values to two decimal places.
- This does **not** simulate a transaction or test every program constraint: oracle freshness and slippage, elevation group compatibility, per-asset flow caps, permissioning, borrow fees, account state changes, and public RPC consistency can affect a real action. A result below displayed limits is not an approval. A live borrow must use Kamino's official flows and re-check state.

Kamino already has an [MCP endpoint listed in its documentation](https://kamino.com/docs) (`https://kamino.com/docs/mcp`), an [agent skill](https://kamino.com/docs/skill.md), and [llms.txt](https://kamino.com/docs/llms.txt). Use those for the agent route. This example does not duplicate an MCP server.
