import Decimal from 'decimal.js';
import type { AccountReport, InvestmentPosition, Ledger, LedgerTransaction } from './types';
import { reportPeriod } from './period';
import { accountKind, arithmetic, costUnits, text } from './report-values';

const holdingKey = (account: string, commodity: string) => JSON.stringify([account, commodity]);
function feeAccount(name: string) {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1:$2').split(/[:_-]/);
  return parts.some(part => /^(fees?|commissions?|tax(?:es)?)$/i.test(part) || /(?:手续费|佣金|税)$/.test(part));
}

function holdingTransactions(ledger: Ledger, events: LedgerTransaction[], goods: Set<string>, D: typeof Decimal) {
  const transactions = new Map<string, LedgerTransaction[]>();
  for (const transaction of events) {
    const seen = new Set<string>();
    for (const posting of transaction.postings) {
      if (!goods.has(posting.currency) || !['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? '')) continue;
      if (new D(posting.amount).isZero()) continue;
      const key = holdingKey(posting.account, posting.currency);
      if (seen.has(key)) continue;
      seen.add(key);
      const matching = transactions.get(key);
      if (matching) matching.push(transaction);
      else transactions.set(key, [transaction]);
    }
  }
  return transactions;
}

/** Identify monetary balances held in investment accounts without treating receivables as investments. */
export function isInvestmentAccount(name: string): boolean {
  const parts = name.split(':').slice(1).map(part => part.toLowerCase());
  return parts.some(part => ['investment', 'investments', 'fund', 'funds', 'stock', 'stocks', 'bond', 'bonds'].includes(part))
    && !parts.some(part => ['cash', 'bank', 'banks', 'debit', 'deposit', 'deposits'].includes(part));
}

export function summarizeInvestments(ledger: Ledger, report: AccountReport, currency: string) {
  const { D, sum } = arithmetic(ledger);
  const monetaryAssets = report.accounts.filter(account => account.kind === 'asset' && account.role === 'other' && (isInvestmentAccount(account.name) || ledger.accounts.some(item => item.name === account.name && item.role === 'investment')));
  const end = report.asOf ?? (report.month ? reportPeriod(report.month).end : '9999-12-31');
  const goods = costUnits(ledger, end);
  const events = ledger.transactions.filter(transaction => transaction.date <= end);
  const transactions = holdingTransactions(ledger, events, goods, D);
  // Allocate settlement only when one identifiable holding is involved. A transfer,
  // currency conversion, or combined trade must not invent a cash allocation.
  const cashFlows = (account: string, commodity: string, unit: string) => {
    let invested = new D(0), withdrawn = new D(0), seen = false;
    for (const transaction of transactions.get(holdingKey(account, commodity)) ?? []) {
      const trades = transaction.postings.filter(posting => posting.account === account && posting.currency === commodity && !new D(posting.amount).isZero());
      if (!trades.length) continue;
      seen = true;
      const others = transaction.postings.filter(posting => !trades.includes(posting));
      const buying = trades.every(posting => new D(posting.amount).gt(0));
      const selling = trades.every(posting => new D(posting.amount).lt(0));
      if ((!buying && !selling) || trades.some(posting => !posting.cost || posting.cost.currency !== unit || new D(posting.cost.amount).lt(0))
        || others.some(posting => posting.cost || posting.price || goods.has(posting.currency) || posting.currency !== unit)) return null;
      const settlements = others.filter(posting => ['asset', 'liability', 'equity'].includes(accountKind(ledger, posting.account) ?? ''));
      if (!settlements.length || (selling && settlements.some(posting => accountKind(ledger, posting.account) === 'equity'))) return null;
      // Do not mistake salary mixed into a trade, an unlinked distribution or a
      // shopping expense for investment proceeds or a commission.
      if (others.some(posting => {
        const kind = accountKind(ledger, posting.account);
        return !kind || (kind === 'income' && (buying || !/(?:^|:)(?:CapitalGains?|Gains?|PnL|Profit|投资收益|投资损益|资本利得)(?::|$)/i.test(posting.account)))
          || (kind === 'expense' && !feeAccount(posting.account));
      })) return null;
      const settlement = sum(settlements.map(posting => posting.amount));
      if ((buying && settlement.gt(0)) || (selling && settlement.lt(0))) return null;
      if (buying) invested = invested.minus(settlement);
      else withdrawn = withdrawn.plus(settlement);
    }
    return seen ? { invested, withdrawn } : null;
  };
  const positionsByLot = new Map<string, InvestmentPosition>();
  for (const position of report.positions) {
    const key = JSON.stringify([position.account, position.commodity, position.unitCost, position.costCurrency, position.costDate, position.costLabel]);
    const previous = positionsByLot.get(key);
    if (!previous || (position.currency === currency && previous.currency !== currency)
      || (previous.currency !== currency && position.currency === position.costCurrency && previous.currency !== previous.costCurrency)) positionsByLot.set(key, position);
  }
  const positions = [...positionsByLot.values()];
  const groups = new Map<string, InvestmentPosition[]>();
  for (const position of positions) {
    const key = JSON.stringify([position.account, position.commodity, position.currency]);
    groups.set(key, [...(groups.get(key) ?? []), position]);
  }
  const holdings = [...groups.values()].map(lots => {
    const costsComplete = lots.every(lot => lot.cost !== null && lot.costCurrency && !new Decimal(lot.units).isNegative());
    const costCurrencies = [...new Set(lots.map(lot => lot.costCurrency).filter((value): value is string => Boolean(value)))];
    const costs = costsComplete ? costCurrencies.map(costCurrency => ({
      currency: costCurrency,
      amount: text(sum(lots.filter(lot => lot.costCurrency === costCurrency).map(lot => lot.cost!))),
    })) : null;
    const marketValue = lots.some(lot => lot.marketValue === null) ? null : text(sum(lots.map(lot => lot.marketValue!)));
    const units = sum(lots.map(lot => lot.units));
    const unrealizedPnl = marketValue === null || costs === null || lots.some(lot => lot.unrealizedPnl === null || lot.costCurrency !== lot.currency) ? null : text(sum(lots.map(lot => lot.unrealizedPnl!)));
    const singleCost = costs?.length === 1 ? costs[0] : null;
    const flows = units.gt(0) && costsComplete ? cashFlows(lots[0].account, lots[0].commodity, lots[0].currency) : null;
    const netInvested = flows ? flows.invested.minus(flows.withdrawn) : null;
    const cumulativePnl = marketValue !== null && netInvested !== null ? new D(marketValue).minus(netInvested) : null;
    const realizedPnl = netInvested !== null && singleCost?.currency === lots[0].currency ? new D(singleCost.amount).minus(netInvested) : null;
    return {
      account: lots[0].account, accountLabel: lots[0].accountLabel, commodity: lots[0].commodity, currency: lots[0].currency,
      marketValue, units: text(units),
      invested: flows ? text(flows.invested) : null, withdrawn: flows ? text(flows.withdrawn) : null,
      netInvested: netInvested === null ? null : text(netInvested),
      cumulativePnl: cumulativePnl === null ? null : text(cumulativePnl),
      realizedPnl: realizedPnl === null ? null : text(realizedPnl),
      cumulativeReturnRate: cumulativePnl !== null && flows!.invested.gt(0) ? text(cumulativePnl.div(flows!.invested).times(100)) : null,
      breakEvenPrice: netInvested === null ? null : text(D.max(0, netInvested).div(units)),
      costs,
      averageCost: singleCost && units.gt(0) ? text(new D(singleCost.amount).div(units)) : null,
      unrealizedPnl,
      returnRate: unrealizedPnl !== null && singleCost && new D(singleCost.amount).gt(0) ? text(new D(unrealizedPnl).div(singleCost.amount).times(100)) : null,
      lots: [...lots].sort((a, b) => !a.costDate ? (b.costDate ? 1 : 0) : !b.costDate ? -1 : b.costDate.localeCompare(a.costDate)),
    };
  }).sort((a, b) => a.currency.localeCompare(b.currency) || (a.marketValue === null ? (b.marketValue === null ? 0 : 1) : b.marketValue === null ? -1 : new D(b.marketValue).cmp(a.marketValue)) || a.commodity.localeCompare(b.commodity));
  // Each currency is independent; an incomplete valuation is never shown as a total.
  const totals = [...new Set(holdings.map(holding => holding.currency))].map(unit => {
    const items = holdings.filter(holding => holding.currency === unit);
    const marketValue = items.every(item => item.marketValue !== null) ? text(sum(items.map(item => item.marketValue!))) : null;
    const cost = items.every(item => item.costs?.length === 1 && item.costs[0].currency === unit) ? text(sum(items.map(item => item.costs![0].amount))) : null;
    const unrealizedPnl = items.every(item => item.unrealizedPnl !== null) ? text(sum(items.map(item => item.unrealizedPnl!))) : null;
    const invested = items.every(item => item.invested !== null) ? text(sum(items.map(item => item.invested!))) : null;
    const cumulativePnl = items.every(item => item.cumulativePnl !== null) ? text(sum(items.map(item => item.cumulativePnl!))) : null;
    const realizedPnl = items.every(item => item.realizedPnl !== null) ? text(sum(items.map(item => item.realizedPnl!))) : null;
    return { currency: unit, count: items.length, marketValue, cost, unrealizedPnl, invested, cumulativePnl, realizedPnl,
      cumulativeReturnRate: cumulativePnl !== null && invested !== null && new D(invested).gt(0) ? text(new D(cumulativePnl).div(invested).times(100)) : null,
      returnRate: unrealizedPnl !== null && cost !== null && new D(cost).gt(0) ? text(new D(unrealizedPnl).div(cost).times(100)) : null };
  });
  return { monetaryAssets, holdings, totals };
}
