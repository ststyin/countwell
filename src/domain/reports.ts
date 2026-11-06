import Decimal from 'decimal.js';
import type { AccountBalance, AccountReport, Activity, ActivityAmount, BillingCycle, PaymentAccountSpending, InvestmentPosition, Ledger, LedgerTransaction, Overview, TransactionQuery, TransactionKind } from './types';
import { reportPeriod } from './period';
import { accountKind, arithmetic, costUnits, isInvestmentFeeAccount, isInvestmentGainAccount, label, text } from './report-values';
export { monthBounds } from './period';
export { isInvestmentAccount, summarizeInvestments } from './investments';

function reportingKind(ledger: Ledger, account: string) {
  const kind = accountKind(ledger, account);
  return kind === 'income' && isInvestmentGainAccount(account) ? 'investment' : kind;
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
    const kind = reportingKind(ledger, posting.account);
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
    const kind = reportingKind(ledger, posting.account);
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
  type FlowKind = 'income' | 'expense' | 'investment';
  const groups = new Map<string, { amount: Decimal; currency: string; type: FlowKind; basis: 'units' | 'weight' }>();
  const add = (type: FlowKind, amount: string, currency: string, basis: 'units' | 'weight') => {
    const key = `${type}\0${currency}\0${basis}`;
    const previous = groups.get(key);
    groups.set(key, { type, currency, basis, amount: (previous?.amount ?? new D(0)).plus(amount) });
  };
  for (const posting of transaction.postings) {
    const type = reportingKind(ledger, posting.account);
    if (type !== 'income' && type !== 'expense' && type !== 'investment') continue;
    add(type, posting.amount, posting.currency, 'units');
    if (posting.cost || posting.price) {
      const annotation = posting.cost ?? posting.price!;
      const weight = posting.weight ?? { amount: new D(posting.amount).times(annotation.amount).toFixed(), currency: annotation.currency };
      if (weight.currency !== posting.currency || !new D(weight.amount).equals(posting.amount)) add(type, weight.amount, weight.currency, 'weight');
    }
  }
  const amounts: ActivityAmount[] = [...groups.values()].map(group => {
    const expense = group.type === 'expense';
    const signed = expense ? group.amount : group.amount.negated();
    const kind = expense && signed.isNegative() ? 'refund' : group.type;
    const direction = (expense ? signed.isNegative() : !signed.isNegative()) ? 'in' : 'out';
    return { amount: text(signed.abs()), currency: group.currency, direction, kind, basis: group.basis };
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
  const corresponding = transaction.postings.filter(posting => posting.currency === primary.currency && reportingKind(ledger, posting.account) === (kind === 'income' ? 'income' : 'expense'));
  let category = kind === 'income' ? primary.direction === 'out' ? '收入冲回' : corresponding.length === 1 ? label(ledger, corresponding[0].account) : '多项收入' : kind === 'expense' || kind === 'refund' ? corresponding.length === 1 ? label(ledger, corresponding[0].account) : '多项支出' : kind === 'investment' ? '投资买入' : '账户转账';
  if (kind === 'investment') {
    const booked = transaction.postings.filter(posting => posting.cost);
    if (!booked.length) category = '投资盈亏';
    else if (booked.every(posting => new D(posting.amount).isNegative())) category = '投资卖出';
  }
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

type AccountContribution = { account: string; currency: string; amount: Decimal | null };
type PaymentContribution = AccountContribution & { direction: 'expense' | 'refund'; settlement?: Activity['investmentSettlement'] };

/** Attribute charges and refunds to their payment accounts, excluding transfers. */
function paymentContributions(ledger: Ledger, transaction: LedgerTransaction, D: typeof Decimal): PaymentContribution[] {
  const expenses = transaction.postings.filter(posting => accountKind(ledger, posting.account) === 'expense');
  const incomes = transaction.postings.filter(posting => reportingKind(ledger, posting.account) === 'income');
  if (!expenses.length && !incomes.length) return [];
  if (expenses.length) {
    const sale = singleAccountSale(ledger, transaction, D);
    if (sale) {
      const amount = expenses.reduce((sum, posting) => sum.plus(posting.amount), new D(0));
      return amount.isZero() ? [] : [{ account: sale.cash.account, currency: sale.cash.currency, amount,
        direction: amount.isNegative() ? 'refund' : 'expense', settlement: sale.settlement }];
    }
  }
  const paymentPostings = transaction.postings.filter(posting => ['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? ''));
  const groups = new Map<string, typeof paymentPostings>();
  for (const posting of paymentPostings) {
    const key = JSON.stringify([posting.account, posting.currency]);
    groups.set(key, [...(groups.get(key) ?? []), posting]);
  }
  const entries = [...groups.values()].map(postings => ({
    account: postings[0].account, currency: postings[0].currency, postings,
    change: postings.reduce((sum, posting) => sum.plus(posting.amount), new D(0)),
  }));
  const result: PaymentContribution[] = [];
  for (const entry of entries) {
    const hasMixedSigns = entry.postings.some(posting => new D(posting.amount).isNegative()) && entry.postings.some(posting => new D(posting.amount).isPositive());
    if (entry.change.isZero() && !hasMixedSigns) continue;
    // A charge can reduce income in the ledger while increasing the card balance owed.
    const cardIncomes = entry.change.lt(0) && isCreditCard(ledger, entry.account)
      ? incomes.filter(posting => posting.currency === entry.currency) : [];
    const incomeOffset = cardIncomes.reduce((sum, posting) => sum.plus(posting.amount), new D(0));
    const charges = incomeOffset.gt(0) ? [...expenses, ...cardIncomes] : expenses;
    if (!charges.length) continue;
    const sameCurrency = charges.filter(posting => posting.currency === entry.currency);
    const netCharge = sameCurrency.reduce((sum, posting) => sum.plus(posting.amount), new D(0));
    const hasAnnotations = [...charges, ...entry.postings].some(posting => posting.cost || posting.price);
    const unmatchedCurrency = !sameCurrency.length;
    const zeroCharge = netCharge.isZero();
    // A repayment accompanied by a fee, or an unrelated opposing leg, is not a purchase/refund.
    if (!unmatchedCurrency && !zeroCharge && netCharge.isPositive() === entry.change.isPositive() && !hasAnnotations && !hasMixedSigns) continue;
    const relatedPaymentTotal = entries.filter(other => other.currency === entry.currency && other.change.isPositive() === entry.change.isPositive())
      .reduce((sum, other) => sum.plus(other.change.abs()), new D(0));
    const ambiguous = hasAnnotations || hasMixedSigns || unmatchedCurrency || zeroCharge || relatedPaymentTotal.gt(netCharge.abs());
    result.push({ account: entry.account, currency: entry.currency, amount: ambiguous ? null : entry.change.negated(), direction: entry.change.gt(0) ? 'refund' : 'expense' });
  }
  return result;
}

/** Net spending for each payment account and currency in the selected period. */
export function getPaymentAccountSpending(ledger: Ledger, month: string, cycle?: BillingCycle): PaymentAccountSpending[] {
  const { D } = arithmetic(ledger);
  const { start, end } = reportPeriod(month, cycle);
  const totals = new Map<string, { account: string; currency: string; amount: Decimal; unavailable: boolean; transactionCount: number }>();
  for (const transaction of ledger.transactions) {
    if (transaction.date < start || transaction.date > end) continue;
    for (const item of paymentContributions(ledger, transaction, D)) {
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

/** The same account legs as the summary, preserving their original transactions for inspection. */
export function getPaymentAccountSpendingTransactions(ledger: Ledger, query: TransactionQuery & { account: string }): Activity[] {
  const { D } = arithmetic(ledger);
  const { start, end } = query.month === undefined ? { start: '0001-01-01', end: '9999-12-31' } : reportPeriod(query.month, query.cycle);
  const search = query.search?.toLowerCase() ?? '';
  return ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end && (!query.date || transaction.date === query.date))
    .flatMap(transaction => paymentContributions(ledger, transaction, D)
      .filter(item => item.account === query.account && (!query.currency || item.currency === query.currency))
      .map(item => {
        const amounts = activityAmounts(ledger, transaction, D);
        const row = activity(ledger, transaction, amounts, item.currency, item.direction);
        return { ...row, kind: item.direction, direction: item.direction === 'expense' ? 'out' : 'in', currency: item.currency,
          category: item.settlement ? '投资卖出' : row.category,
          account: item.account, accountLabel: label(ledger, item.account),
          amount: item.amount === null ? row.amount : text(item.amount.abs()), amountUnavailable: item.amount === null,
          amountBasis: 'units', amounts: item.settlement ? amounts : [], investmentSettlement: item.settlement } satisfies Activity;
      }))
    .filter(result => !search || `${result.payee}\n${result.narration}\n${result.category}\n${result.accountLabel}\n${result.postings.map(posting => label(ledger, posting.account)).join('\n')}`.toLowerCase().includes(search))
    .reverse();
}

type IncomeContribution = AccountContribution & { direction: 'in' | 'out' };

/** Attribute income to financial accounts without treating transfers or expense refunds as income. */
function receivingContributions(ledger: Ledger, transaction: LedgerTransaction, D: typeof Decimal): IncomeContribution[] {
  const incomes = transaction.postings.filter(posting => reportingKind(ledger, posting.account) === 'income');
  if (!incomes.length) return [];
  const financial = transaction.postings.filter(posting => ['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? ''));
  const groups = new Map<string, typeof financial>();
  for (const posting of financial) {
    const key = JSON.stringify([posting.account, posting.currency]);
    groups.set(key, [...(groups.get(key) ?? []), posting]);
  }
  const entries = [...groups.values()].map(postings => ({
    account: postings[0].account, currency: postings[0].currency, postings,
    change: postings.reduce((sum, posting) => sum.plus(posting.amount), new D(0)),
  }));
  const result: IncomeContribution[] = [];
  for (const entry of entries) {
    const mixedSigns = entry.postings.some(posting => new D(posting.amount).isNegative()) && entry.postings.some(posting => new D(posting.amount).isPositive());
    if (entry.change.isZero() && !mixedSigns) continue;
    const sameCurrency = incomes.filter(posting => posting.currency === entry.currency);
    const income = sameCurrency.reduce((sum, posting) => sum.minus(posting.amount), new D(0));
    const annotated = [...incomes, ...entry.postings].some(posting => posting.cost || posting.price);
    if (sameCurrency.length && !income.isZero() && income.isPositive() !== entry.change.isPositive() && !annotated && !mixedSigns) continue;
    const relatedTotal = entries.filter(other => other.currency === entry.currency && other.change.isPositive() === entry.change.isPositive())
      .reduce((sum, other) => sum.plus(other.change.abs()), new D(0));
    const hasExpenses = transaction.postings.some(posting => accountKind(ledger, posting.account) === 'expense');
    const ambiguous = annotated || mixedSigns || !sameCurrency.length || income.isZero() || relatedTotal.gt(income.abs()) || hasExpenses;
    result.push({ account: entry.account, currency: entry.currency, amount: ambiguous ? null : entry.change, direction: entry.change.isNegative() ? 'out' : 'in' });
  }
  return result;
}

/** Net income received by each financial account, in each original currency. */
export function getReceivingAccountIncome(ledger: Ledger, month: string, cycle?: BillingCycle): PaymentAccountSpending[] {
  const { D } = arithmetic(ledger);
  const { start, end } = reportPeriod(month, cycle);
  const totals = new Map<string, { account: string; currency: string; amount: Decimal; unavailable: boolean; transactionCount: number }>();
  for (const transaction of ledger.transactions) {
    if (transaction.date < start || transaction.date > end) continue;
    for (const item of receivingContributions(ledger, transaction, D)) {
      const key = JSON.stringify([item.account, item.currency]);
      const row = totals.get(key) ?? { account: item.account, currency: item.currency, amount: new D(0), unavailable: false, transactionCount: 0 };
      if (item.amount === null) row.unavailable = true;
      else row.amount = row.amount.plus(item.amount);
      row.transactionCount++;
      totals.set(key, row);
    }
  }
  return [...totals.values()].map(({ unavailable, amount, ...row }) => ({ ...row, amount: unavailable ? null : text(amount) }))
    .sort((a, b) => a.account.localeCompare(b.account) || (a.currency === 'CNY' ? -1 : b.currency === 'CNY' ? 1 : a.currency.localeCompare(b.currency)));
}

/** The matching income and reversals behind an account's summary. */
export function getReceivingAccountIncomeTransactions(ledger: Ledger, query: TransactionQuery & { account: string; currency: string }): Activity[] {
  const { D } = arithmetic(ledger);
  const { start, end } = query.month === undefined ? { start: '0001-01-01', end: '9999-12-31' } : reportPeriod(query.month, query.cycle);
  const search = query.search?.toLowerCase() ?? '';
  return ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end && (!query.date || transaction.date === query.date))
    .flatMap(transaction => {
      const item = receivingContributions(ledger, transaction, D).find(value => value.account === query.account && value.currency === query.currency);
      if (!item) return [];
      const amounts = activityAmounts(ledger, transaction, D);
      const row = activity(ledger, transaction, amounts, query.currency, 'income');
      const result: Activity = { ...row, kind: 'income', direction: item.direction, currency: item.currency,
        category: item.direction === 'out' ? '收入冲回' : row.category,
        amount: item.amount === null ? row.amount : text(item.amount.abs()), amountUnavailable: item.amount === null, amountBasis: 'units', amounts: [] };
      return !search || `${result.payee}\n${result.narration}\n${result.category}\n${result.accountLabel}\n${result.postings.map(posting => label(ledger, posting.account)).join('\n')}`.toLowerCase().includes(search) ? [result] : [];
    }).reverse();
}

/** Preserve older credit-card links while using the same allocation rules. */
export function getCreditCardSpending(ledger: Ledger, month: string, cycle?: BillingCycle): PaymentAccountSpending[] {
  return getPaymentAccountSpending(ledger, month, cycle).filter(row => isCreditCard(ledger, row.account));
}

export function getCreditCardSpendingTransactions(ledger: Ledger, query: TransactionQuery & { account: string; currency: string }): Activity[] {
  return isCreditCard(ledger, query.account) ? getPaymentAccountSpendingTransactions(ledger, query) : [];
}

function investmentSettlement(ledger: Ledger, transaction: LedgerTransaction, D: typeof Decimal): Activity['investmentSettlement'] {
  const booked = transaction.postings.filter(posting => posting.cost && ['asset', 'liability'].includes(accountKind(ledger, posting.account) ?? '') && !new D(posting.amount).isZero());
  if (!booked.length) return undefined;
  const action = booked.every(posting => new D(posting.amount).isNegative()) ? 'sell'
    : booked.every(posting => new D(posting.amount).isPositive()) ? 'buy' : 'exchange';
  const tradeGroups = new Map<string, typeof booked>();
  for (const posting of booked) {
    const key = JSON.stringify([posting.account, posting.currency, new D(posting.amount).isNegative()]);
    const group = tradeGroups.get(key);
    if (group) group.push(posting);
    else tradeGroups.set(key, [posting]);
  }
  const trades = [...tradeGroups.values()].map(group => {
    const first = group[0];
    const price = first.price;
    const uniformPrice = price && group.every(posting => posting.price?.currency === price.currency && new D(posting.price.amount).eq(price.amount));
    const units = group.reduce((sum, posting) => sum.plus(posting.amount), new D(0));
    return { account: first.account, commodity: first.currency, units: text(units.abs()), direction: units.isNegative() ? 'sell' as const : 'buy' as const,
      price: uniformPrice ? price : undefined };
  });
  const cash = new Map<string, { account: string; currency: string; amount: Decimal }>();
  const fees = new Map<string, Decimal>();
  for (const posting of transaction.postings) {
    if (posting.cost || posting.price) continue;
    if (isInvestmentFeeAccount(posting.account) && accountKind(ledger, posting.account) === 'expense') {
      fees.set(posting.currency, (fees.get(posting.currency) ?? new D(0)).plus(posting.amount));
    }
    if (!ledger.accounts.some(account => account.name === posting.account && account.kind === 'asset' && account.role === 'cash')) continue;
    const key = JSON.stringify([posting.account, posting.currency]);
    const previous = cash.get(key);
    cash.set(key, { account: posting.account, currency: posting.currency, amount: (previous?.amount ?? new D(0)).plus(posting.amount) });
  }
  return { action, trades, fees: [...fees].filter(([, amount]) => !amount.isZero()).map(([currency, amount]) => ({ currency, amount: text(amount) })),
    cashFlows: [...cash.values()].filter(row => !row.amount.isZero()).map(row => ({
    account: row.account, accountLabel: label(ledger, row.account), amount: text(row.amount.abs()), currency: row.currency,
    direction: row.amount.isNegative() ? 'out' : 'in',
  })) };
}

/** A same-currency sale with one cash destination can attribute its fees without guessing. */
function singleAccountSale(ledger: Ledger, transaction: LedgerTransaction, D: typeof Decimal) {
  const settlement = investmentSettlement(ledger, transaction, D);
  if (settlement?.action !== 'sell' || settlement.cashFlows.length !== 1) return;
  const [cash] = settlement.cashFlows;
  if (cash.direction !== 'in') return;
  const attributable = transaction.postings.every(posting => {
    const kind = accountKind(ledger, posting.account);
    if (posting.cost) return kind === 'asset' && posting.cost.currency === cash.currency && new D(posting.amount).lt(0);
    if (posting.price || posting.currency !== cash.currency) return false;
    return kind === 'income' || kind === 'expense' || (posting.account === cash.account && new D(posting.amount).gte(0));
  });
  if (attributable) return { settlement, cash };
}

export function getTransactions(ledger: Ledger, query: TransactionQuery): Activity[] {
  if (query.kind === 'expense' && query.account && isCreditCard(ledger, query.account)) {
    return getPaymentAccountSpendingTransactions(ledger, { ...query, account: query.account }).filter(row => row.kind === 'expense');
  }
  const { D } = arithmetic(ledger);
  const { start, end } = query.month === undefined ? { start: '0001-01-01', end: '9999-12-31' } : reportPeriod(query.month, query.cycle);
  const search = query.search?.toLowerCase() ?? '';
  return ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end && (!query.date || transaction.date === query.date))
    .map(transaction => ({ transaction, amounts: activityAmounts(ledger, transaction, D) }))
    .filter(({ transaction, amounts }) => (!query.currency || amounts.some(amount => amount.currency === query.currency))
      && (!query.kind || query.kind === 'all' || amounts.some(amount => amount.kind === query.kind && (!query.currency || amount.currency === query.currency)))
      && (!query.account || query.account === 'all' || transaction.postings.some(posting => posting.account === query.account)))
    .map(({ transaction, amounts }) => ({ ...activity(ledger, transaction, amounts, query.currency, query.kind === 'all' ? undefined : query.kind),
      investmentSettlement: investmentSettlement(ledger, transaction, D) }))
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
  return { month: month ?? '', asOf: end, currency, currencies: moneyCurrencies(ledger), cash: text(cash), otherAssets: text(otherAssets), investments: investments === null ? null : text(investments), liabilities: text(liabilities), overpayments: text(overpayments), availableFunds: text(cash.minus(liabilities)), netWorth: investments === null ? null : text(cash.plus(otherAssets).plus(investments).plus(signedLiabilities)), previousCash: text(previousCash), cashChange: text(cash.minus(previousCash)), accounts, positions, warnings: investments === null ? ['部分持仓缺少可用的同币种直接报价，暂不展示完整投资合计与净资产。'] : [] };
}
