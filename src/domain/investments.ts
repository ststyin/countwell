import Decimal from 'decimal.js';
import type { AccountReport, InvestmentPosition, Ledger, LedgerTransaction } from './types';
import { reportPeriod } from './period';
import { accountKind, arithmetic, costUnits, label, text } from './report-values';

const holdingKey = (account: string, commodity: string) => JSON.stringify([account, commodity]);
function feeAccount(name: string) {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1:$2').split(/[:_-]/);
  return parts.some(part => /^(fees?|commissions?|tax(?:es)?)$/i.test(part) || /(?:手续费|佣金|税)$/.test(part));
}
const dividendAccount = (name: string) => name.split(':').some(part => /^(dividends?|分红|股息)$/i.test(part));

type HoldingJournal = {
  account: string;
  commodity: string;
  units: Decimal;
  costCurrencies: Set<string>;
  firstDate: string;
  transactions: LedgerTransaction[];
};

function holdingJournals(ledger: Ledger, events: LedgerTransaction[], goods: Set<string>, D: typeof Decimal) {
  const journals = new Map<string, HoldingJournal>();
  for (const transaction of events) {
    const seen = new Set<string>();
    for (const posting of transaction.postings) {
      if (!goods.has(posting.currency) || !['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? '')) continue;
      const units = new D(posting.amount);
      if (units.isZero()) continue;
      const key = holdingKey(posting.account, posting.currency);
      let journal = journals.get(key);
      if (!journal) {
        journal = { account: posting.account, commodity: posting.currency, units: new D(0), costCurrencies: new Set(), firstDate: transaction.date, transactions: [] };
        journals.set(key, journal);
      }
      journal.units = journal.units.plus(units);
      if (posting.cost) journal.costCurrencies.add(posting.cost.currency);
      if (transaction.date < journal.firstDate) journal.firstDate = transaction.date;
      if (!seen.has(key)) journal.transactions.push(transaction);
      seen.add(key);
    }
  }
  return journals;
}

function cashDividends(ledger: Ledger, events: LedgerTransaction[], funds: HoldingJournal[], goods: Set<string>, D: typeof Decimal) {
  const amounts = new Map<string, Decimal>();
  let unallocated = 0;
  const commodities = new Set(funds.map(fund => fund.commodity.toLowerCase()));
  for (const transaction of events) {
    const income = transaction.postings.filter(posting => dividendAccount(posting.account) && accountKind(ledger, posting.account) === 'income');
    if (!income.length) continue;
    const currency = income[0].currency;
    if (transaction.postings.some(posting => posting.currency !== currency || posting.cost || posting.price || goods.has(posting.currency))) {
      unallocated++;
      continue;
    }
    const named = income.map(posting => posting.account.split(':').slice(1).map(part => part.toLowerCase()).filter(part => commodities.has(part)));
    const candidates = funds.filter(fund => fund.firstDate <= transaction.date
      && (!transaction.investmentAccount || fund.account === transaction.investmentAccount)
      && named.every(parts => parts.length ? parts.every(part => part === fund.commodity.toLowerCase()) : Boolean(transaction.investmentAccount)));
    const fund = candidates.length === 1 ? candidates[0] : undefined;
    const cash = transaction.postings.filter(posting => accountKind(ledger, posting.account) === 'asset');
    const supported = transaction.postings.every(posting => income.includes(posting) || cash.includes(posting)
      || (accountKind(ledger, posting.account) === 'expense' && feeAccount(posting.account)));
    if (!fund || fund.costCurrencies.size !== 1 || !fund.costCurrencies.has(currency) || !cash.length || !supported) {
      unallocated++;
      continue;
    }
    const received = cash.reduce((total, posting) => total.plus(posting.amount), new D(0));
    const gross = income.reduce((total, posting) => total.minus(posting.amount), new D(0));
    if ((gross.gt(0) && (received.lt(0) || received.gt(gross))) || (gross.lt(0) && (received.gt(0) || received.lt(gross))) || (gross.isZero() && !received.isZero())) {
      unallocated++;
      continue;
    }
    const key = holdingKey(fund.account, fund.commodity);
    amounts.set(key, (amounts.get(key) ?? new D(0)).plus(received));
  }
  return { amounts, unallocated };
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
  const journals = holdingJournals(ledger, events, goods, D);
  // Allocate settlement only when one identifiable holding is involved. A transfer,
  // currency conversion, or combined trade must not invent a cash allocation.
  const cashFlows = (account: string, commodity: string, unit: string) => {
    let invested = new D(0), withdrawn = new D(0), seen = false;
    for (const transaction of journals.get(holdingKey(account, commodity))?.transactions ?? []) {
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
  const funds = [...journals.values()].filter(journal => journal.costCurrencies.size > 0 && accountKind(ledger, journal.account) === 'asset');
  const dividend = cashDividends(ledger, events, funds, goods, D);
  const historyPositions = new Map<string, InvestmentPosition[]>();
  for (const position of report.positions) {
    const key = holdingKey(position.account, position.commodity);
    const positions = historyPositions.get(key);
    if (positions) positions.push(position);
    else historyPositions.set(key, [position]);
  }
  const history = funds.map(fund => {
    const key = holdingKey(fund.account, fund.commodity);
    const unit = fund.costCurrencies.size === 1 ? [...fund.costCurrencies][0] : '';
    const positions = historyPositions.get(key) ?? [];
    const closed = fund.units.isZero() && positions.length === 0;
    const lots = positions.filter(position => position.currency === unit);
    const completeLots = lots.length > 0 && fund.units.eq(sum(lots.map(lot => lot.units))) && lots.every(lot => new D(lot.units).gt(0));
    const values = completeLots && lots.every(lot => lot.marketValue !== null);
    const cost = completeLots && lots.every(lot => lot.costCurrency === unit && lot.cost !== null);
    const marketValue = closed ? new D(0) : values ? sum(lots.map(lot => lot.marketValue!)) : null;
    const remainingCost = closed ? new D(0) : cost ? sum(lots.map(lot => lot.cost!)) : null;
    const flows = unit && (closed || fund.units.gt(0)) ? cashFlows(fund.account, fund.commodity, unit) : null;
    const dividends = unit ? dividend.amounts.get(key) ?? new D(0) : null;
    const realizedPnl = remainingCost && flows ? remainingCost.plus(flows.withdrawn).minus(flows.invested) : null;
    const cumulativePnl = marketValue && flows && dividends ? marketValue.plus(flows.withdrawn).plus(dividends).minus(flows.invested) : null;
    return {
      account: fund.account, accountLabel: label(ledger, fund.account), commodity: fund.commodity, currency: unit, closed,
      marketValue: marketValue === null ? null : text(marketValue),
      invested: flows ? text(flows.invested) : null,
      withdrawn: flows ? text(flows.withdrawn) : null,
      dividends: dividends === null ? null : text(dividends),
      realizedPnl: realizedPnl === null ? null : text(realizedPnl),
      cumulativePnl: cumulativePnl === null ? null : text(cumulativePnl),
    };
  }).sort((a, b) => Number(a.closed) - Number(b.closed) || a.commodity.localeCompare(b.commodity) || a.account.localeCompare(b.account));
  const historyTotals = [...new Set(history.map(fund => fund.currency).filter(Boolean))].sort().map(unit => {
    const items = history.filter(fund => fund.currency === unit);
    const total = (field: 'marketValue' | 'invested' | 'withdrawn' | 'dividends' | 'realizedPnl' | 'cumulativePnl') => {
      const values = items.map(fund => fund[field]);
      return values.every(value => value !== null) ? text(sum(values)) : null;
    };
    return {
      currency: unit, count: items.length,
      marketValue: total('marketValue'), invested: total('invested'), withdrawn: total('withdrawn'), dividends: total('dividends'),
      realizedPnl: total('realizedPnl'), cumulativePnl: total('cumulativePnl'),
    };
  });
  return { monetaryAssets, holdings, totals, history, historyTotals, unallocatedDividends: dividend.unallocated };
}
