import Decimal from 'decimal.js';
import type { AccountBalance, AccountKind, AccountReport, Activity, ActivityAmount, BillingCycle, CreditCardSpending, InvestmentPosition, Ledger, LedgerTransaction, Overview, TransactionQuery, TransactionKind } from './types';
import { reportPeriod } from './period';
export { monthBounds } from './period';

const defaultRoots = { assets: 'Assets', liabilities: 'Liabilities', income: 'Income', expenses: 'Expenses', equity: 'Equity' };
const text = (value: Decimal) => value.isZero() ? '0' : value.toFixed();
const label = (ledger: Ledger, name: string) => ledger.accounts.find(account => account.name === name)?.label ?? name.split(':').at(-1)!;

function accountKind(ledger: Ledger, name: string): AccountKind | undefined {
  const explicit = ledger.accounts.find(account => account.name === name)?.kind;
  if (explicit) return explicit;
  const roots = ledger.roots ?? defaultRoots;
  const root = name.split(':')[0];
  return root === roots.assets ? 'asset' : root === roots.liabilities ? 'liability' : root === roots.income ? 'income' : root === roots.expenses ? 'expense' : root === roots.equity ? 'equity' : undefined;
}

function arithmetic(ledger: Ledger) {
  const numbers = ledger.transactions.flatMap(transaction => transaction.postings.flatMap(posting => [posting.amount, posting.cost?.amount, posting.price?.amount].filter((value): value is string => value !== undefined))).concat(ledger.prices.map(price => price.amount));
  let integerDigits = 1, scale = 0;
  for (const value of numbers) {
    const number = new Decimal(value);
    if (!number.isFinite()) throw new Error('账本包含非有限金额，不能生成报表');
    integerDigits = Math.max(integerDigits, number.e + 1);
    scale = Math.max(scale, number.decimalPlaces());
  }
  const D = Decimal.clone({ precision: Math.max(80, 2 * (integerDigits + scale) + String(numbers.length + 1).length + 8) });
  return { D, sum: (values: string[]) => values.reduce((total, value) => total.plus(value), new D(0)) };
}


function costUnits(ledger: Ledger, end = '9999-12-31'): Set<string> {
  return new Set(ledger.transactions.filter(transaction => transaction.date <= end).flatMap(transaction => transaction.postings.filter(posting => posting.cost).map(posting => posting.currency)));
}

function moneyCurrencies(ledger: Ledger): string[] {
  const goods = costUnits(ledger);
  const currencies = new Set(ledger.operatingCurrencies ?? []);
  for (const transaction of ledger.transactions) for (const posting of transaction.postings) {
    if (!goods.has(posting.currency) || currencies.has(posting.currency)) currencies.add(posting.currency);
    if (posting.cost) currencies.add(posting.cost.currency);
    if (posting.price) currencies.add(posting.price.currency);
  }
  for (const quote of ledger.prices) currencies.add(quote.currency);
  // Commodity declarations are not a currency classifier: CNY/USD declarations
  // are common and must not erase ordinary cash balances.
  return [...currencies].sort((a, b) => a === 'CNY' ? -1 : b === 'CNY' ? 1 : a.localeCompare(b));
}

function flowForPeriod(ledger: Ledger, month: string, currency: string, D: typeof Decimal, cycle?: BillingCycle) {
  const { start, end } = reportPeriod(month, cycle);
  const transactions = ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end);
  const goods = costUnits(ledger, end);
  let income = new D(0), expense = new D(0), supported = true;
  for (const transaction of transactions) for (const posting of transaction.postings) {
    const kind = accountKind(ledger, posting.account);
    if (kind !== 'income' && kind !== 'expense') continue;
    const relevant = posting.currency === currency || posting.cost?.currency === currency || posting.price?.currency === currency;
    if (relevant && (posting.cost || posting.price || goods.has(posting.currency))) supported = false;
    if (posting.currency !== currency) continue;
    if (kind === 'income') income = income.minus(posting.amount);
    else expense = expense.plus(posting.amount);
  }
  return { income, expense, transactions, supported };
}

/** Only a single currency is aggregated, and unsupported flows fail closed. */
export function getOverview(ledger: Ledger, month: string, currency = 'CNY', cycle?: BillingCycle): Overview {
  const { D } = arithmetic(ledger);
  const { dates, previous } = reportPeriod(month, cycle);
  const current = flowForPeriod(ledger, month, currency, D, cycle);
  const before = previous.startsWith('0000') ? { income: new D(0), expense: new D(0), supported: true } : flowForPeriod(ledger, previous, currency, D, cycle);
  const visibleTransactions = getTransactions(ledger, { month, currency, cycle });
  const daily = new Map(dates.map(date => [date, new D(0)]));
  const expenses = new Map<string, Decimal>(), incomes = new Map<string, Decimal>();
  if (current.supported) for (const transaction of current.transactions) for (const posting of transaction.postings) {
    if (posting.currency !== currency) continue;
    const kind = accountKind(ledger, posting.account);
    if (kind === 'expense') {
      expenses.set(posting.account, (expenses.get(posting.account) ?? new D(0)).plus(posting.amount));
      daily.set(transaction.date, daily.get(transaction.date)!.plus(posting.amount));
    } else if (kind === 'income') incomes.set(posting.account, (incomes.get(posting.account) ?? new D(0)).minus(posting.amount));
  }
  const categoryRows = (values: Map<string, Decimal>, total: Decimal) => [...values].map(([account, amount]) => ({ account, name: label(ledger, account), amount: text(amount), share: total.isZero() ? 0 : amount.div(total).times(100).toNumber() })).sort((a, b) => new D(b.amount).cmp(a.amount));
  const change = (now: Decimal, prior: Decimal) => !current.supported || !before.supported || prior.isZero() ? null : now.minus(prior).div(prior.abs()).times(100).toNumber();
  return {
    month, currency, currencies: moneyCurrencies(ledger), flowSupported: current.supported, previousFlowSupported: before.supported,
    warnings: current.supported ? [] : [cycle && cycle.mode !== 'calendar' ? '本期收支包含成本、价格或商品数量，暂不生成收支和分类合计；完整交易与账户余额仍可查看。' : '本月收支包含成本、价格或商品数量，暂不生成收支和分类合计；完整交易与账户余额仍可查看。'],
    income: current.supported ? text(current.income) : '0', expense: current.supported ? text(current.expense) : '0', surplus: current.supported ? text(current.income.minus(current.expense)) : '0',
    previousIncome: before.supported ? text(before.income) : '0', previousExpense: before.supported ? text(before.expense) : '0', previousSurplus: before.supported ? text(before.income.minus(before.expense)) : '0',
    incomeChange: change(current.income, before.income), expenseChange: change(current.expense, before.expense),
    transactionCount: visibleTransactions.length, pendingCount: visibleTransactions.filter(transaction => transaction.flag === '!').length,
    dailyExpenses: [...daily].map(([date, amount]) => ({ date, amount: text(amount) })), categories: categoryRows(expenses, current.expense), incomeCategories: categoryRows(incomes, current.income),
  };
}

function activityAmounts(ledger: Ledger, transaction: LedgerTransaction, D: typeof Decimal): ActivityAmount[] {
  const groups = new Map<string, { amount: Decimal; currency: string; type: 'income' | 'expense'; basis: 'units' | 'weight' }>();
  const add = (type: 'income' | 'expense', amount: string, currency: string, basis: 'units' | 'weight') => {
    const key = `${type}\0${currency}\0${basis}`;
    const previous = groups.get(key);
    groups.set(key, { type, currency, basis, amount: (previous?.amount ?? new D(0)).plus(amount) });
  };
  for (const posting of transaction.postings) {
    const kind = accountKind(ledger, posting.account);
    if (kind !== 'income' && kind !== 'expense') continue;
    add(kind, posting.amount, posting.currency, 'units');
    if (posting.cost || posting.price) {
      const annotation = posting.cost ?? posting.price!;
      const weight = posting.weight ?? { amount: new D(posting.amount).times(annotation.amount).toFixed(), currency: annotation.currency };
      if (weight.currency !== posting.currency || !new D(weight.amount).equals(posting.amount)) add(kind, weight.amount, weight.currency, 'weight');
    }
  }
  const amounts: ActivityAmount[] = [...groups.values()].map(group => {
    const signed = group.type === 'income' ? group.amount.negated() : group.amount;
    const kind = group.type === 'income' ? 'income' : signed.isNegative() ? 'refund' : 'expense';
    return { amount: text(signed.abs()), currency: group.currency, direction: group.type === 'income' ? signed.isNegative() ? 'out' : 'in' : signed.isNegative() ? 'in' : 'out', kind, basis: group.basis };
  });
  const booked = transaction.postings.filter(posting => posting.cost && ['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? ''));
  for (const currency of new Set(booked.map(posting => posting.cost!.currency))) {
    const weights = booked.filter(posting => posting.cost!.currency === currency).map(posting => new D(posting.amount).times(posting.cost!.amount));
    const incoming = weights.filter(value => value.isPositive()).reduce((total, value) => total.plus(value), new D(0));
    const outgoing = weights.filter(value => value.isNegative()).reduce((total, value) => total.plus(value), new D(0));
    amounts.push({ amount: text(incoming.isZero() ? outgoing.abs() : incoming), currency, direction: 'internal', kind: 'investment', basis: 'weight' });
  }
  if (amounts.length) return amounts;
  for (const currency of new Set(transaction.postings.map(posting => posting.currency))) {
    const financial = transaction.postings.filter(posting => posting.currency === currency && ['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? ''));
    const positive = financial.filter(posting => new D(posting.amount).isPositive()).reduce((total, posting) => total.plus(posting.amount), new D(0));
    const negative = financial.filter(posting => new D(posting.amount).isNegative()).reduce((total, posting) => total.plus(posting.amount), new D(0));
    const fallback = transaction.postings.find(posting => posting.currency === currency)!;
    amounts.push({ amount: text(!positive.isZero() ? positive : !negative.isZero() ? negative.abs() : new D(fallback.amount).abs()), currency, direction: 'internal', kind: 'transfer', basis: 'units' });
  }
  return amounts;
}

function activity(ledger: Ledger, transaction: LedgerTransaction, amounts: ActivityAmount[], selected?: string, preferred?: TransactionKind): Activity {
  const D = Decimal;
  const candidates = selected ? amounts.filter(amount => amount.currency === selected) : amounts;
  const primary = candidates.find(amount => amount.kind === preferred) ?? candidates[0] ?? amounts[0];
  const kind = primary.kind;
  const corresponding = transaction.postings.filter(posting => posting.currency === primary.currency && accountKind(ledger, posting.account) === (kind === 'income' ? 'income' : 'expense'));
  let category = kind === 'income' ? primary.direction === 'out' ? '收入冲回' : corresponding.length === 1 ? label(ledger, corresponding[0].account) : '多项收入' : kind === 'expense' || kind === 'refund' ? corresponding.length === 1 ? label(ledger, corresponding[0].account) : '多项支出' : kind === 'investment' ? '投资买入' : '账户转账';
  if (kind === 'investment' && transaction.postings.filter(posting => posting.cost).every(posting => new D(posting.amount).isNegative())) category = '投资卖出';
  if (kind === 'transfer' && transaction.postings.some(posting => accountKind(ledger, posting.account) === 'liability')) {
    const liabilityChanges = transaction.postings.filter(posting => accountKind(ledger, posting.account) === 'liability' && posting.currency === primary.currency);
    category = liabilityChanges.every(posting => new D(posting.amount).isPositive()) ? '负债还款' : liabilityChanges.every(posting => new D(posting.amount).isNegative()) ? '借款或负债增加' : '负债变动';
  }
  if (kind === 'transfer' && transaction.postings.some(posting => accountKind(ledger, posting.account) === 'equity')) category = '期初余额';
  const assets = transaction.postings.filter(posting => accountKind(ledger, posting.account) === 'asset');
  const outgoing = assets.find(posting => posting.currency === primary.currency && new D(posting.amount).isNegative()) ?? assets.find(posting => new D(posting.amount).isNegative());
  const incoming = assets.find(posting => posting.currency === primary.currency && new D(posting.amount).isPositive()) ?? assets.find(posting => new D(posting.amount).isPositive());
  const repaymentTarget = transaction.postings.find(posting => accountKind(ledger, posting.account) === 'liability' && posting.currency === primary.currency && new D(posting.amount).isPositive());
  const borrowingSource = transaction.postings.find(posting => accountKind(ledger, posting.account) === 'liability' && posting.currency === primary.currency && new D(posting.amount).isNegative());
  const representative = outgoing ?? incoming ?? transaction.postings[0];
  return { ...transaction, kind, direction: primary.direction, category, amount: primary.amount, currency: primary.currency, amountBasis: primary.basis, amounts, account: representative.account, accountLabel: label(ledger, representative.account), fromAccount: outgoing?.account ?? borrowingSource?.account, toAccount: incoming?.account ?? repaymentTarget?.account };
}

function isCreditCard(ledger: Ledger, account: string): boolean {
  return accountKind(ledger, account) === 'liability'
    && account.split(':').slice(1).some(part => /^(creditcard|credit-card|credit_card|credit|card|cc|信用卡)$/i.test(part));
}

type CardContribution = { account: string; currency: string; amount: Decimal | null; direction: 'expense' | 'refund' };

/** Attribute only the card leg of expense transactions; repayments and transfers are excluded. */
function cardContributions(ledger: Ledger, transaction: LedgerTransaction, D: typeof Decimal): CardContribution[] {
  const expenses = transaction.postings.filter(posting => accountKind(ledger, posting.account) === 'expense');
  if (!expenses.length) return [];
  const cardPostings = transaction.postings.filter(posting => isCreditCard(ledger, posting.account));
  const groups = new Map<string, typeof cardPostings>();
  for (const posting of cardPostings) {
    const key = JSON.stringify([posting.account, posting.currency]);
    groups.set(key, [...(groups.get(key) ?? []), posting]);
  }
  const entries = [...groups.values()].map(postings => ({
    account: postings[0].account, currency: postings[0].currency, postings,
    change: postings.reduce((sum, posting) => sum.plus(posting.amount), new D(0)),
  }));
  const result: CardContribution[] = [];
  for (const entry of entries) {
    const hasMixedCardSigns = entry.postings.some(posting => new D(posting.amount).isNegative()) && entry.postings.some(posting => new D(posting.amount).isPositive());
    if (entry.change.isZero() && !hasMixedCardSigns) continue;
    const sameCurrency = expenses.filter(posting => posting.currency === entry.currency);
    const expense = sameCurrency.reduce((sum, posting) => sum.plus(posting.amount), new D(0));
    const hasAnnotations = [...expenses, ...entry.postings].some(posting => posting.cost || posting.price);
    const unmatchedCurrency = !sameCurrency.length;
    const zeroExpense = expense.isZero();
    // A repayment accompanied by a fee, or an unrelated opposing leg, is not a purchase/refund.
    if (!unmatchedCurrency && !zeroExpense && expense.isPositive() === entry.change.isPositive() && !hasAnnotations && !hasMixedCardSigns) continue;
    const relatedCardTotal = entries.filter(other => other.currency === entry.currency && other.change.isPositive() === entry.change.isPositive())
      .reduce((sum, other) => sum.plus(other.change.abs()), new D(0));
    const ambiguous = hasAnnotations || hasMixedCardSigns || unmatchedCurrency || zeroExpense || relatedCardTotal.gt(expense.abs());
    result.push({ account: entry.account, currency: entry.currency, amount: ambiguous ? null : entry.change.negated(), direction: entry.change.gt(0) ? 'refund' : 'expense' });
  }
  return result;
}

/** Per-card net consumption in the selected billing period, kept separate by currency. */
export function getCreditCardSpending(ledger: Ledger, month: string, cycle?: BillingCycle): CreditCardSpending[] {
  const { D } = arithmetic(ledger);
  const { start, end } = reportPeriod(month, cycle);
  const totals = new Map<string, { account: string; currency: string; amount: Decimal; unavailable: boolean; transactionCount: number }>();
  for (const transaction of ledger.transactions) {
    if (transaction.date < start || transaction.date > end) continue;
    for (const item of cardContributions(ledger, transaction, D)) {
      const key = JSON.stringify([item.account, item.currency]);
      const row = totals.get(key) ?? { account: item.account, currency: item.currency, amount: new D(0), unavailable: false, transactionCount: 0 };
      if (item.amount === null) row.unavailable = true;
      else row.amount = row.amount.plus(item.amount);
      row.transactionCount++;
      totals.set(key, row);
    }
  }
  return [...totals.values()].map(row => ({ account: row.account, currency: row.currency, amount: row.unavailable ? null : text(row.amount), transactionCount: row.transactionCount }))
    .sort((a, b) => a.account.localeCompare(b.account) || (a.currency === 'CNY' ? -1 : b.currency === 'CNY' ? 1 : a.currency.localeCompare(b.currency)));
}

/** The same card legs as the summary, preserving their original transactions for inspection. */
export function getCreditCardSpendingTransactions(ledger: Ledger, query: TransactionQuery & { account: string; currency: string }): Activity[] {
  const { D } = arithmetic(ledger);
  const { start, end } = query.month === undefined ? { start: '0001-01-01', end: '9999-12-31' } : reportPeriod(query.month, query.cycle);
  const search = query.search?.toLowerCase() ?? '';
  return ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end && (!query.date || transaction.date === query.date))
    .flatMap(transaction => {
      const item = cardContributions(ledger, transaction, D).find(value => value.account === query.account && value.currency === query.currency);
      if (!item) return [];
      const amounts = activityAmounts(ledger, transaction, D);
      const row = activity(ledger, transaction, amounts, query.currency, item.direction);
      const result: Activity = { ...row, kind: item.direction, direction: item.direction === 'expense' ? 'out' : 'in', currency: item.currency,
        amount: item.amount === null ? row.amount : text(item.amount.abs()), amountUnavailable: item.amount === null, amountBasis: 'units', amounts: [] };
      return !search || `${result.payee}\n${result.narration}\n${result.category}\n${result.accountLabel}\n${result.postings.map(posting => label(ledger, posting.account)).join('\n')}`.toLowerCase().includes(search) ? [result] : [];
    }).reverse();
}

export function getTransactions(ledger: Ledger, query: TransactionQuery): Activity[] {
  const { D } = arithmetic(ledger);
  const { start, end } = query.month === undefined ? { start: '0001-01-01', end: '9999-12-31' } : reportPeriod(query.month, query.cycle);
  const search = query.search?.toLowerCase() ?? '';
  return ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end && (!query.date || transaction.date === query.date))
    .map(transaction => ({ transaction, amounts: activityAmounts(ledger, transaction, D) }))
    .filter(({ transaction, amounts }) => (!query.currency || amounts.some(amount => amount.currency === query.currency))
      && (!query.kind || query.kind === 'all' || amounts.some(amount => amount.kind === query.kind && (!query.currency || amount.currency === query.currency)))
      && (!query.account || query.account === 'all' || transaction.postings.some(posting => posting.account === query.account)))
    .map(({ transaction, amounts }) => activity(ledger, transaction, amounts, query.currency, query.kind === 'all' ? undefined : query.kind))
    .filter(item => !search || `${item.payee}\n${item.narration}\n${item.category}\n${item.accountLabel}\n${item.postings.map(posting => label(ledger, posting.account)).join('\n')}`.toLowerCase().includes(search))
    .reverse();
}

/** Values are independently reported for each currency, with no implicit FX. */
export function getAccounts(ledger: Ledger, month?: string, currency = 'CNY', cycle?: BillingCycle): AccountReport {
  const { D, sum } = arithmetic(ledger);
  const { start, end } = month === undefined ? { start: '0001-01-01', end: '9999-12-31' } : reportPeriod(month, cycle);
  const goods = costUnits(ledger, end);
  const operating = new Set(ledger.operatingCurrencies ?? []);
  const investmentUnits = new Set([...goods].filter(unit => !operating.has(unit)));
  const balances = new Map<string, { account: string; currency: string; opening: Decimal; closing: Decimal }>();
  type Lot = { account: string; commodity: string; costCurrency: string | null; unitCost: string | null; date: string | null; label: string | null; units: Decimal };
  const lots = new Map<string, Lot>();
  for (const transaction of ledger.transactions) {
    if (transaction.date > end) continue;
    for (const posting of transaction.postings) {
      const kind = accountKind(ledger, posting.account);
      if (kind !== 'asset' && kind !== 'liability') continue;
      const balanceKey = `${posting.account}\0${posting.currency}`;
      const balance = balances.get(balanceKey) ?? { account: posting.account, currency: posting.currency, opening: new D(0), closing: new D(0) };
      balance.closing = balance.closing.plus(posting.amount);
      if (transaction.date < start) balance.opening = balance.opening.plus(posting.amount);
      balances.set(balanceKey, balance);
      if (posting.cost || investmentUnits.has(posting.currency)) {
        const key = JSON.stringify([posting.account, posting.currency, posting.cost?.currency ?? null, posting.cost?.amount ?? null, posting.cost?.date ?? null, posting.cost?.label ?? null]);
        const lot = lots.get(key) ?? { account: posting.account, commodity: posting.currency, costCurrency: posting.cost?.currency ?? null, unitCost: posting.cost?.amount ?? null, date: posting.cost?.date ?? null, label: posting.cost?.label ?? null, units: new D(0) };
        lot.units = lot.units.plus(posting.amount);
        lots.set(key, lot);
      }
    }
  }
  const accountsWithHoldings = new Set([...lots.values()].map(lot => lot.account));
  const accounts: AccountBalance[] = [...balances.values()].map(balance => {
    const account = ledger.accounts.find(item => item.name === balance.account);
    const role: AccountBalance['role'] = investmentUnits.has(balance.currency) ? 'investment' : account?.role === 'investment' ? (accountsWithHoldings.has(balance.account) ? 'cash' : 'other') : account?.role ?? 'cash';
    return { name: balance.account, label: label(ledger, balance.account), kind: accountKind(ledger, balance.account) as 'asset' | 'liability', role, balance: text(balance.closing), opening: text(balance.opening), change: text(balance.closing.minus(balance.opening)), currency: balance.currency };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));
  const positions: InvestmentPosition[] = [];
  for (const lot of lots.values()) {
    if (lot.units.isZero()) continue;
    const available = ledger.prices.filter(price => price.commodity === lot.commodity && price.date <= end);
    const targets = new Set(available.map(price => price.currency));
    if (lot.costCurrency) targets.add(lot.costCurrency);
    if (!targets.size) targets.add('');
    for (const target of targets) {
      const quote = available.filter(price => price.currency === target).reduce<typeof available[number] | undefined>((selected, price) => !selected || price.date >= selected.date ? price : selected, undefined);
      const status = target === lot.commodity ? 'unsupported_pair' : !quote ? 'missing_price' : !new D(quote.amount).isPositive() ? 'invalid_price' : 'ok';
      const cost = lot.unitCost === null ? null : lot.units.times(lot.unitCost);
      const value = quote && status === 'ok' ? lot.units.times(quote.amount) : null;
      positions.push({ account: lot.account, accountLabel: label(ledger, lot.account), commodity: lot.commodity, units: text(lot.units), currency: target, cost: cost === null ? null : text(cost), unitCost: lot.unitCost, costCurrency: lot.costCurrency, costDate: lot.date, costLabel: lot.label, price: quote?.amount ?? null, priceDate: quote?.date ?? null, marketValue: value === null ? null : text(value), unrealizedPnl: value === null || cost === null || lot.units.isNegative() || target !== lot.costCurrency ? null : text(value.minus(cost)), status });
    }
  }
  const selected = accounts.filter(account => account.currency === currency && account.role !== 'investment');
  const selectedPositions = positions.filter(position => position.currency === currency || position.currency === '');
  const cash = sum(selected.filter(account => account.kind === 'asset' && account.role === 'cash').map(account => account.balance));
  const previousCash = sum(selected.filter(account => account.kind === 'asset' && account.role === 'cash').map(account => account.opening));
  const otherAssets = sum(selected.filter(account => account.kind === 'asset' && account.role === 'other').map(account => account.balance));
  const liabilities = sum(selected.filter(account => account.kind === 'liability').map(account => D.max(new D(account.balance).negated(), 0).toFixed()));
  const overpayments = sum(selected.filter(account => account.kind === 'liability').map(account => D.max(account.balance, 0).toFixed()));
  const investments = selectedPositions.some(position => position.marketValue === null) ? null : sum(selectedPositions.map(position => position.marketValue!));
  const signedLiabilities = sum(selected.filter(account => account.kind === 'liability').map(account => account.balance));
  return { month: month ?? '', currency, currencies: moneyCurrencies(ledger), cash: text(cash), otherAssets: text(otherAssets), investments: investments === null ? null : text(investments), liabilities: text(liabilities), overpayments: text(overpayments), netWorth: investments === null ? null : text(cash.plus(otherAssets).plus(investments).plus(signedLiabilities)), previousCash: text(previousCash), cashChange: text(cash.minus(previousCash)), accounts, positions, warnings: investments === null ? ['部分持仓缺少可用的同币种直接报价，暂不展示完整投资合计与净资产。'] : [] };
}

/** Identify monetary balances held in investment accounts without treating receivables as investments. */
export function isInvestmentAccount(name: string): boolean {
  const parts = name.split(':').slice(1).map(part => part.toLowerCase());
  return parts.some(part => ['investment', 'investments', 'fund', 'funds', 'stock', 'stocks', 'bond', 'bonds'].includes(part))
    && !parts.some(part => ['cash', 'bank', 'banks', 'debit', 'deposit', 'deposits'].includes(part));
}

export function summarizeInvestments(ledger: Ledger, report: AccountReport, currency: string) {
  const { sum } = arithmetic(ledger);
  const monetaryAssets = report.accounts.filter(account => account.kind === 'asset' && account.role === 'other' && isInvestmentAccount(account.name));
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
  const holdings = [...groups.values()].map(lots => ({
    account: lots[0].account, accountLabel: lots[0].accountLabel, commodity: lots[0].commodity, currency: lots[0].currency,
    marketValue: lots.some(lot => lot.marketValue === null) ? null : text(sum(lots.map(lot => lot.marketValue!))),
    lots: [...lots].sort((a, b) => !a.costDate ? (b.costDate ? 1 : 0) : !b.costDate ? -1 : b.costDate.localeCompare(a.costDate)),
  }));
  return { monetaryAssets, holdings };
}
