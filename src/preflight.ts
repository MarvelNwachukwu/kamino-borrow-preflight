import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  KaminoMarket,
  getCurrentLedgerInstant,
  type ObligationStats,
} from '@kamino-finance/klend-sdk';
import { address, createSolanaRpc, type Address } from '@solana/kit';
import { Decimal } from 'decimal.js';

const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
// Kamino's SDK example identifies this address as the USDC reserve in Main.
const MAIN_USDC_RESERVE = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
const BANNER = 'READ ONLY: cannot sign or submit. No wallet connection, key, transaction, or instruction is used.';

type Flags = { market: Address; reserve: string; amount: string; wallet?: Address; html: string };
type Health = {
  ltvPercent: string;
  borrowLimitUsd: string;
  liquidationThresholdPercent: string;
  liquidationLimitUsd: string;
  weightedDebtUsd: string;
  collateralUsd: string;
};
type Position = {
  obligation: string;
  elevationGroup: number;
  current: Health;
  after: Health;
  exceedsBorrowLimit: boolean;
  reachesLiquidationThreshold: boolean;
  enoughReserveLiquidity: boolean;
  enoughReserveBorrowCap: boolean;
  reserveActive: boolean;
  preflight: 'within displayed limits' | 'blocked by displayed limits';
};
type Report = {
  banner: string;
  timestamp: string;
  slot: string;
  market: Address;
  wallet: Address | null;
  request: { amount: string; amountBaseUnits: string };
  reserve: {
    symbol: string; address: Address; decimals: number; status: string;
    availableTokens: string; borrowedTokens: string; remainingBorrowCapTokens: string;
    utilizationPercent: string; borrowApyPercent: string;
  };
  positions: Position[];
  note: string;
};

function parseFlags(argv: string[]): Flags {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: npm run preflight -- --reserve USDC --amount 10 [--wallet PUBLIC_ADDRESS] [--market MARKET_ADDRESS] [--html report.html]');
    process.exit(0);
  }
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!['--reserve', '--amount', '--wallet', '--market', '--html'].includes(key) || !value || value.startsWith('--') || options.has(key)) {
      throw Error(`Invalid argument near ${key ?? '(end)'}. Run with --help.`);
    }
    options.set(key, value);
  }
  const amount = options.get('--amount');
  if (!amount || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || !new Decimal(amount).gt(0)) {
    throw Error('--amount must be a positive token amount written without exponent notation');
  }
  return {
    market: address(options.get('--market') ?? MAIN_MARKET),
    reserve: options.get('--reserve') ?? 'USDC',
    amount,
    wallet: options.has('--wallet') ? address(options.get('--wallet')!) : undefined,
    html: options.get('--html') ?? 'report.html',
  };
}

function finite(value: Decimal | number, places = 4): string {
  const d = new Decimal(value);
  return d.isFinite() ? d.toFixed(places) : 'N/A';
}

function health(stats: ObligationStats): Health {
  return {
    ltvPercent: finite(stats.loanToValue.mul(100), 2),
    borrowLimitUsd: finite(stats.borrowLimit, 2),
    liquidationThresholdPercent: finite(stats.liquidationLtv.mul(100), 2),
    liquidationLimitUsd: finite(stats.borrowLiquidationLimit, 2),
    weightedDebtUsd: finite(stats.userTotalBorrowBorrowFactorAdjusted, 2),
    collateralUsd: finite(stats.userTotalCollateralDeposit, 2),
  };
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function html(report: Report): string {
  const e = escapeHtml;
  const metric = (label: string, value: string, suffix = '') => `<div class="metric"><span>${e(label)}</span><strong>${e(value)}${e(suffix)}</strong></div>`;
  const positions = report.positions.map(p => `<article class="position">
    <div class="position-head"><div><span class="eyebrow">OBLIGATION · ELEVATION GROUP ${p.elevationGroup}</span><h2>${e(p.obligation)}</h2></div><b class="pill ${p.preflight.startsWith('blocked') ? 'blocked' : 'ok'}">${e(p.preflight)}</b></div>
    <div class="columns"><section><h3>Current · SDK</h3>${metric('LTV', p.current.ltvPercent, '%')}${metric('Borrow limit', '$' + p.current.borrowLimitUsd)}${metric('Liquidation LTV', p.current.liquidationThresholdPercent, '%')}${metric('Liquidation debt limit', '$' + p.current.liquidationLimitUsd)}${metric('Borrow-factor-adjusted debt', '$' + p.current.weightedDebtUsd)}</section>
    <section><h3>After · SDK simulation</h3>${metric('LTV', p.after.ltvPercent, '%')}${metric('Borrow limit', '$' + p.after.borrowLimitUsd)}${metric('Liquidation LTV', p.after.liquidationThresholdPercent, '%')}${metric('Liquidation debt limit', '$' + p.after.liquidationLimitUsd)}${metric('Borrow-factor-adjusted debt', '$' + p.after.weightedDebtUsd)}</section></div>
    <p class="checks">Borrow limit ${p.exceedsBorrowLimit ? 'EXCEEDED' : 'not exceeded'} · Liquidation threshold ${p.reachesLiquidationThreshold ? 'REACHED' : 'not reached'} · Reserve liquidity ${p.enoughReserveLiquidity ? 'sufficient' : 'insufficient'} · Reserve borrow cap ${p.enoughReserveBorrowCap ? 'available' : 'exceeded'} · Reserve ${p.reserveActive ? 'active' : 'not active'}</p>
  </article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kamino borrow preflight · ${e(report.reserve.symbol)}</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e9f5f0;background:#071b1a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% -10%,#17634c 0%,#071b1a 46%);min-height:100vh}.shell{max-width:1060px;margin:auto;padding:42px 24px 80px}.banner{background:#a7e947;color:#142315;padding:15px 19px;border-radius:10px;font-weight:800;letter-spacing:.02em}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.16em;color:#9bd9c4}header{padding:55px 0 32px}h1{font-size:clamp(36px,6vw,62px);line-height:1.03;letter-spacing:-.055em;margin:14px 0}header p{color:#a2bdb5;line-height:1.6;margin:8px 0}code{overflow-wrap:anywhere;color:#d9eee6}.snapshot,.position{background:#12302c;border:1px solid #2a5148;border-radius:18px;padding:26px;margin:18px 0;box-shadow:0 16px 40px #02100d50}.snapshot h2,.position h2{font-size:20px;margin:7px 0 22px;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{padding:17px;background:#0b2420;border-radius:10px;min-width:0}.metric span{display:block;color:#9ab9ae;font-size:12px;margin-bottom:10px}.metric strong{font-size:19px;letter-spacing:-.03em;overflow-wrap:anywhere}.position-head{display:flex;justify-content:space-between;align-items:start;gap:18px}.pill{font-size:12px;border-radius:20px;padding:9px 12px;white-space:nowrap}.ok{background:#26573e;color:#b6f69c}.blocked{background:#6d342d;color:#ffcaab}.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.columns section{display:grid;gap:8px}.columns h3{color:#b1dacb;font-size:13px;text-transform:uppercase;letter-spacing:.08em}.checks{border-top:1px solid #2a5148;padding-top:20px;color:#c8dcd4}footer{font-size:13px;color:#9ab9ae;line-height:1.7;margin-top:38px}footer a{color:#abea96}@media(max-width:760px){.grid{grid-template-columns:1fr 1fr}.columns{grid-template-columns:1fr}.position-head{display:block}.pill{display:inline-block}}@media(max-width:460px){.grid{grid-template-columns:1fr}.shell{padding:18px 14px 55px}}
</style></head><body><main class="shell"><div class="banner">${e(BANNER)}</div><header><span class="eyebrow">KAMINO · BORROW PREFLIGHT / READ-ONLY EXAMPLE</span><h1>Know the limits<br>before borrowing.</h1><p>Snapshot ${e(report.timestamp)} UTC · slot ${e(report.slot)} · market <code>${e(report.market)}</code></p><p>Proposed borrow: <strong>${e(report.request.amount)} ${e(report.reserve.symbol)}</strong>${report.wallet ? ` · wallet <code>${e(report.wallet)}</code>` : ''}</p></header>
<section class="snapshot"><span class="eyebrow">01 / RESERVE SNAPSHOT</span><h2>${e(report.reserve.symbol)} · <code>${e(report.reserve.address)}</code></h2><div class="grid">${metric('Available liquidity', report.reserve.availableTokens + ' ' + report.reserve.symbol)}${metric('Estimated utilization', report.reserve.utilizationPercent, '%')}${metric('Borrow APY', report.reserve.borrowApyPercent, '%')}${metric('Remaining borrow cap', report.reserve.remainingBorrowCapTokens + ' ' + report.reserve.symbol)}</div></section>
${positions || `<article class="position"><span class="eyebrow">02 / POSITION</span><h2>${report.wallet ? 'No existing obligations found in this market' : 'No wallet supplied'}</h2><p>Without an existing obligation, LTV, borrowing capacity, and liquidation risk cannot be evaluated. Supply a public wallet address to preview each existing obligation.</p></article>`}
<footer>Reserve figures and current position fields come from the Kamino SDK. Post-borrow fields come from the SDK obligation simulation. Decimal precision checks and the limit comparisons are local math. This is not a transaction simulation or an approval. Prices, caps, borrow fees, permissions, and state can change before a real borrow. <a href="https://kamino.com/docs/build/developers/overview">Kamino developer docs</a></footer></main></body></html>`;
}

async function preflight(flags: Flags): Promise<Report> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const rpc = createSolanaRpc(rpcUrl);
  const market = await KaminoMarket.load(rpc, flags.market, 400);
  if (!market) throw Error(`Market not found: ${flags.market}`);
  const requestedReserve = flags.market === MAIN_MARKET && flags.reserve.toUpperCase() === 'USDC'
    ? MAIN_USDC_RESERVE : flags.reserve;
  const matches = market.getReserves().filter(r => r.address === requestedReserve || r.symbol.toUpperCase() === requestedReserve.toUpperCase());
  if (matches.length !== 1) throw Error(`Expected one reserve for ${flags.reserve}; found ${matches.length}. Use a reserve address if the symbol is ambiguous.`);
  const reserve = matches[0];
  const amount = new Decimal(flags.amount);
  const amountBaseUnits = amount.mul(reserve.getMintFactor());
  if (!amountBaseUnits.isInteger()) throw Error(`${reserve.symbol} has ${reserve.stats.decimals} decimals; amount cannot include smaller units`);
  const instant = await getCurrentLedgerInstant(rpc);
  const available = reserve.getLiquidityAvailableAmount();
  const { totalBorrow } = reserve.getEstimatedDebtAndSupply(instant, market.state.referralFeeBps);
  const enoughReserveLiquidity = amountBaseUnits.lte(available);
  const remainingBorrowCap = Decimal.max(0, reserve.stats.reserveBorrowLimit.sub(totalBorrow));
  const enoughReserveBorrowCap = amountBaseUnits.lte(remainingBorrowCap);
  const reserveActive = String(reserve.stats.status) === 'Active';
  const obligations = flags.wallet ? await market.getAllUserObligations(flags.wallet, instant) : [];
  const positions: Position[] = obligations.map(obligation => {
    const current = obligation.refreshedStats;
    const after = obligation.getSimulatedObligationStats({
      action: 'borrow', amountDebt: amountBaseUnits, debtReserveAddress: reserve.address,
      market, reserves: market.reserves, currentLedgerInstant: instant,
    }).stats;
    const exceedsBorrowLimit = after.userTotalBorrowBorrowFactorAdjusted.gt(after.borrowLimit);
    const reachesLiquidationThreshold = after.userTotalBorrowBorrowFactorAdjusted.gte(after.borrowLiquidationLimit);
    return {
      obligation: obligation.obligationAddress,
      elevationGroup: obligation.state.elevationGroup,
      current: health(current), after: health(after),
      exceedsBorrowLimit, reachesLiquidationThreshold, enoughReserveLiquidity, enoughReserveBorrowCap, reserveActive,
      preflight: exceedsBorrowLimit || reachesLiquidationThreshold || !enoughReserveLiquidity || !enoughReserveBorrowCap || !reserveActive
        ? 'blocked by displayed limits' : 'within displayed limits',
    };
  });
  return {
    banner: BANNER,
    timestamp: new Date().toISOString(),
    slot: String(instant.slot),
    market: flags.market,
    wallet: flags.wallet ?? null,
    request: { amount: flags.amount, amountBaseUnits: amountBaseUnits.toFixed(0) },
    reserve: {
      symbol: reserve.symbol, address: reserve.address, decimals: reserve.stats.decimals,
      status: String(reserve.stats.status),
      availableTokens: finite(available.div(reserve.getMintFactor()), 2),
      borrowedTokens: finite(totalBorrow.div(reserve.getMintFactor()), 2),
      remainingBorrowCapTokens: finite(remainingBorrowCap.div(reserve.getMintFactor()), 2),
      utilizationPercent: finite(reserve.getEstimatedUtilizationRatio(instant, market.state.referralFeeBps) * 100, 2),
      borrowApyPercent: finite(reserve.totalBorrowAPY(instant) * 100, 2),
    },
    positions,
    note: positions.length ? 'One result per existing obligation; choose a specific obligation before any real action. Informational snapshot, not approval.' : 'No position decision without an existing obligation. Reserve snapshot only.',
  };
}

try {
  const flags = parseFlags(process.argv.slice(2));
  const result = await preflight(flags);
  await writeFile(resolve(flags.html), html(result), 'utf8');
  console.log(JSON.stringify({ ...result, report: resolve(flags.html) }, null, 2));
} catch (error) {
  console.error(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
