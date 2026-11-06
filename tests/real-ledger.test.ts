import { describe, expect, it } from 'vitest';
import { getAccounts, getOverview, getTransactions, summarizeInvestments } from '../src/domain/reports';
import type { Ledger, LedgerAccount, LedgerTransaction, Posting } from '../src/domain/types';

const accounts: LedgerAccount[] = [
  { name: 'Assets:Bank', label: '银行卡', kind: 'asset', role: 'cash' },
  { name: 'Assets:USD', label: '美元账户', kind: 'asset', role: 'cash' },
  { name: 'Assets:Broker', label: '投资账户', kind: 'asset', role: 'investment' },
  { name: 'Liabilities:Card', label: '信用卡', kind: 'liability', role: 'other' },
  { name: 'Income:Salary', label: '工资', kind: 'income', role: 'other' },
  { name: 'Income:Gains', label: '已记账投资收益', kind: 'income', role: 'other' },
  { name: 'Expenses:Food', label: '餐饮', kind: 'expense', role: 'other' },
  { name: 'Equity:Opening', label: '期初权益', kind: 'equity', role: 'other' },
];
const posting = (account: string, amount: string, currency = 'CNY', extra: Partial<Posting> = {}): Posting => ({ account, amount, currency, ...extra });
let sequence = 0;
const transaction = (date: string, narration: string, postings: Posting[], extra: Partial<LedgerTransaction> = {}): LedgerTransaction => ({ id: `real-${++sequence}`, date, payee: '', narration, postings, flag: '*', tags: [], ...extra });
const ledger = (transactions: LedgerTransaction[], extra: Partial<Ledger> = {}): Ledger => ({ title: '官方归一化测试快照', source: '', defaultMonth: '2026-10', accounts, accountNames: accounts.map(account => account.name), transactions: [...transactions].sort((a, b) => a.date.localeCompare(b.date)), prices: [], commodities: [], operatingCurrencies: ['CNY', 'USD'], ...extra });

describe('official normalized snapshots', () => {
  it('uses configured account roots and does not mistake a CNY commodity declaration for a holding', () => {
    const snapshot = ledger([
      transaction('2026-10-01', '工资', [posting('资产:银行', '100'), posting('收入:工资', '-100')]),
      transaction('2026-10-02', '晚餐', [posting('支出:餐饮', '25'), posting('资产:银行', '-25')]),
    ], {
      roots: { assets: '资产', liabilities: '负债', income: '收入', expenses: '支出', equity: '权益' },
      accounts: [
        { name: '资产:银行', label: '银行', kind: 'asset', role: 'cash' },
        { name: '收入:工资', label: '工资', kind: 'income', role: 'other' },
        { name: '支出:餐饮', label: '餐饮', kind: 'expense', role: 'other' },
      ], commodities: ['CNY'],
    });
    expect(getOverview(snapshot, '2026-10')).toMatchObject({ income: '100', expense: '25', surplus: '75', flowSupported: true });
    expect(getAccounts(snapshot, '2026-10')).toMatchObject({ cash: '75', netWorth: '75', positions: [] });
    expect(getTransactions(snapshot, { month: '2026-10', kind: 'expense' })[0]).toMatchObject({ amount: '25', category: '餐饮' });
  });

  it('projects each currency of a multi-currency transaction without summing unlike units', () => {
    const snapshot = ledger([
      transaction('2026-10-01', '两币种收入', [posting('Assets:Bank', '100'), posting('Income:Salary', '-100'), posting('Assets:USD', '20', 'USD'), posting('Income:Salary', '-20', 'USD')]),
      transaction('2026-10-02', '两币种支出', [posting('Expenses:Food', '80'), posting('Assets:Bank', '-80'), posting('Expenses:Food', '15', 'USD'), posting('Assets:USD', '-15', 'USD')]),
    ]);
    expect(getOverview(snapshot, '2026-10', 'CNY')).toMatchObject({ income: '100', expense: '80', surplus: '20', transactionCount: 2 });
    expect(getOverview(snapshot, '2026-10', 'USD')).toMatchObject({ income: '20', expense: '15', surplus: '5', transactionCount: 2 });
    const cny = getTransactions(snapshot, { month: '2026-10', currency: 'CNY', kind: 'expense' });
    const usd = getTransactions(snapshot, { month: '2026-10', currency: 'USD', kind: 'expense' });
    expect(cny[0]).toMatchObject({ amount: '80', currency: 'CNY' });
    expect(usd[0]).toMatchObject({ amount: '15', currency: 'USD' });
    expect(cny[0].postings).toHaveLength(4);
    expect(cny[0].amounts).toEqual(expect.arrayContaining([expect.objectContaining({ amount: '15', currency: 'USD' })]));
  });

  it('keeps both income and expense in a split transaction and filters the appropriate leg', () => {
    const snapshot = ledger([transaction('2026-10-01', '工资扣费用', [posting('Assets:Bank', '99'), posting('Income:Salary', '-100'), posting('Expenses:Food', '1')])]);
    expect(getTransactions(snapshot, { month: '2026-10', currency: 'CNY', kind: 'income' })[0]).toMatchObject({ kind: 'income', amount: '100' });
    expect(getTransactions(snapshot, { month: '2026-10', currency: 'CNY', kind: 'expense' })[0]).toMatchObject({ kind: 'expense', amount: '1' });
    expect(getOverview(snapshot, '2026-10')).toMatchObject({ income: '100', expense: '1', surplus: '99', transactionCount: 1 });
  });

  it('retains nonstandard loaded flags, links and income reversal direction', () => {
    const snapshot = ledger([transaction('2026-10-01', '工资冲回', [posting('Income:Salary', '10', 'CNY', { flag: 'P' }), posting('Assets:Bank', '-10')], { flag: 'P', links: ['salary-adjustment'], tags: ['work'] })]);
    expect(getTransactions(snapshot, { month: '2026-10' })[0]).toMatchObject({ kind: 'income', direction: 'out', amount: '10', flag: 'P', links: ['salary-adjustment'] });
    expect(getOverview(snapshot, '2026-10')).toMatchObject({ income: '-10', pendingCount: 0 });
  });

  it('keeps explicitly non-cash assets out of cash while including them in net worth', () => {
    const snapshot = ledger([transaction('2026-10-01', '应收与现金', [posting('Assets:Bank', '100'), posting('Assets:Receivable', '50'), posting('Equity:Opening', '-150')])], {
      accounts: [...accounts, { name: 'Assets:Receivable', label: '应收款', kind: 'asset', role: 'other' }],
    });
    expect(getAccounts(snapshot, '2026-10')).toMatchObject({ cash: '100', otherAssets: '50', netWorth: '150' });
  });

  it('keeps a currency-only investment account out of cash without losing its value', () => {
    const snapshot = ledger([transaction('2026-10-01', '投资余额', [posting('Assets:Broker', '50'), posting('Assets:Bank', '100'), posting('Equity:Opening', '-150')])]);
    expect(getAccounts(snapshot, '2026-10')).toMatchObject({ cash: '100', otherAssets: '50', netWorth: '150' });
  });

  it('does not call borrowing an income or a credit-card repayment', () => {
    const snapshot = ledger([transaction('2026-10-01', '借款入账', [posting('Assets:Bank', '100'), posting('Liabilities:Card', '-100')])]);
    expect(getTransactions(snapshot, { month: '2026-10' })[0]).toMatchObject({ kind: 'transfer', category: '借款或负债增加', fromAccount: 'Liabilities:Card', toAccount: 'Assets:Bank' });
    expect(getOverview(snapshot, '2026-10')).toMatchObject({ income: '0', expense: '0' });
  });

  it('disables a complete currency summary when cost or price postings make raw-unit flows unsafe', () => {
    const snapshot = ledger([
      transaction('2026-10-01', '普通支出', [posting('Expenses:Food', '5'), posting('Assets:Bank', '-5')]),
      transaction('2026-10-02', '商品支出', [posting('Expenses:Food', '2', 'FUND', { cost: { amount: '10', currency: 'CNY' }, weight: { amount: '20', currency: 'CNY' } }), posting('Assets:Bank', '-20')]),
    ]);
    expect(getOverview(snapshot, '2026-10')).toMatchObject({ flowSupported: false, income: '0', expense: '0', categories: [] });
    expect(getOverview(snapshot, '2026-10').warnings.length).toBeGreaterThan(0);
    expect(getTransactions(snapshot, { month: '2026-10', currency: 'CNY' })[0]).toMatchObject({ kind: 'expense', amount: '20', amountBasis: 'weight' });
    expect(getTransactions(snapshot, { month: '2026-10', currency: 'FUND' })[0]).toMatchObject({ amount: '2', currency: 'FUND', amountBasis: 'units' });
  });

  it('preserves normalized FIFO sale allocations, lot dates and labels in remaining holdings', () => {
    const first = { amount: '20', currency: 'CNY', date: '2026-09-01', label: 'first' };
    const second = { amount: '25', currency: 'CNY', date: '2026-09-20', label: 'second' };
    const snapshot = ledger([
      transaction('2026-08-01', '期初', [posting('Assets:Bank', '1000'), posting('Equity:Opening', '-1000')]),
      transaction('2026-09-01', '第一批买入', [posting('Assets:Broker', '10', 'STOCK', { cost: first }), posting('Assets:Bank', '-200')]),
      transaction('2026-09-20', '第二批买入', [posting('Assets:Broker', '5', 'STOCK', { cost: second }), posting('Assets:Bank', '-125')]),
      transaction('2026-10-01', 'FIFO 售出', [posting('Assets:Broker', '-10', 'STOCK', { cost: first, price: { amount: '30', currency: 'CNY' } }), posting('Assets:Broker', '-2', 'STOCK', { cost: second, price: { amount: '30', currency: 'CNY' } }), posting('Assets:Bank', '360'), posting('Income:Gains', '-110')]),
    ], { prices: [{ date: '2026-10-31', commodity: 'STOCK', amount: '31', currency: 'CNY' }, { date: '2026-11-01', commodity: 'STOCK', amount: '999', currency: 'CNY' }] });
    const report = getAccounts(snapshot, '2026-10');
    expect(report).toMatchObject({ cash: '1035', investments: '93', netWorth: '1128' });
    expect(report.positions).toHaveLength(1);
    expect(report.positions[0]).toMatchObject({ units: '3', cost: '75', costDate: '2026-09-20', costLabel: 'second', marketValue: '93', unrealizedPnl: '18' });
    expect(summarizeInvestments(snapshot, report, 'CNY').holdings[0]).toMatchObject({ costs: [{ currency: 'CNY', amount: '75' }], marketValue: '93', unrealizedPnl: '18', cumulativePnl: '128' });
    expect(getOverview(snapshot, '2026-10')).toMatchObject({ income: '0', expense: '0', surplus: '0', flowSupported: true });
  });

  it('summarizes each holding across lots without combining currencies or inventing missing prices', () => {
    const first = { amount: '20', currency: 'CNY', date: '2026-09-01', label: 'A' };
    const second = { amount: '25', currency: 'CNY', date: '2026-09-20', label: 'B' };
    const snapshot = ledger([
      transaction('2026-09-01', 'A', [posting('Assets:Broker', '2', 'STOCK', { cost: first }), posting('Assets:Bank', '-40')]),
      transaction('2026-09-20', 'B', [posting('Assets:Broker', '3', 'STOCK', { cost: second }), posting('Assets:Bank', '-75')]),
    ], { prices: [{ date: '2026-10-01', commodity: 'STOCK', amount: '30', currency: 'CNY' }, { date: '2026-10-01', commodity: 'STOCK', amount: '5', currency: 'USD' }] });
    const report = getAccounts(snapshot, undefined, 'CNY');
    const summary = summarizeInvestments(snapshot, report, 'CNY');
    expect(summary.holdings).toHaveLength(1);
    expect(summary.holdings[0]).toMatchObject({ commodity: 'STOCK', currency: 'CNY', marketValue: '150', costs: [{ currency: 'CNY', amount: '115' }], unrealizedPnl: '35' });
    expect(summary.holdings[0].lots.map(lot => lot.costLabel)).toEqual(['B', 'A']);
    const dated = report.positions.filter(position => position.currency === 'CNY');
    const sameDay = { ...dated[1], costLabel: 'C' };
    const undated = { ...dated[0], costDate: null, costLabel: 'undated' };
    const mixed = { ...report, positions: [undated, dated[1], sameDay, dated[0]] };
    expect(summarizeInvestments(snapshot, mixed, 'CNY').holdings[0].lots.map(lot => lot.costLabel)).toEqual(['B', 'C', 'A', 'undated']);
    const missing = { ...report, positions: report.positions.filter(position => position.currency === 'CNY').map(position => ({ ...position, marketValue: null })) };
    expect(summarizeInvestments(snapshot, missing, 'CNY').holdings[0]).toMatchObject({ marketValue: null, costs: [{ currency: 'CNY', amount: '115' }], unrealizedPnl: null });
  });

  it('keeps costs visible without quotes and never invents incomplete or cross-currency gains', () => {
    const snapshot = ledger([
      transaction('2026-09-01', '人民币买入', [posting('Assets:Broker', '2', 'STOCK', { cost: { amount: '20', currency: 'CNY', date: '2026-09-01' } }), posting('Assets:Bank', '-40')]),
      transaction('2026-09-20', '美元买入', [posting('Assets:Broker', '3', 'STOCK', { cost: { amount: '5', currency: 'USD', date: '2026-09-20' } }), posting('Assets:USD', '-15', 'USD')]),
    ], { prices: [{ date: '2026-10-01', commodity: 'STOCK', amount: '30', currency: 'CNY' }] });
    const report = getAccounts(snapshot, undefined, 'CNY');
    const holding = summarizeInvestments(snapshot, report, 'CNY').holdings[0];
    expect(holding).toMatchObject({ marketValue: '150', unrealizedPnl: null });
    expect(holding.costs).toEqual(expect.arrayContaining([{ currency: 'CNY', amount: '40' }, { currency: 'USD', amount: '15' }]));
    const missingPrice = ledger(snapshot.transactions);
    const missingHolding = summarizeInvestments(missingPrice, getAccounts(missingPrice), 'CNY').holdings;
    expect(missingHolding.every(item => item.marketValue === null && item.unrealizedPnl === null)).toBe(true);
    expect(missingHolding.flatMap(item => item.costs ?? [])).toEqual(expect.arrayContaining([{ currency: 'CNY', amount: '40' }, { currency: 'USD', amount: '15' }]));
    const incomplete = { ...report, positions: report.positions.map(position => position.costLabel === null && position.costCurrency === 'CNY' ? { ...position, cost: null, unitCost: null, unrealizedPnl: null } : position) };
    expect(summarizeInvestments(snapshot, incomplete, 'CNY').holdings[0]).toMatchObject({ costs: null, unrealizedPnl: null });
  });

  it('does not merge equal unit costs whose official booked lot dates or labels differ', () => {
    const snapshot = ledger([
      transaction('2026-10-01', 'A', [posting('Assets:Broker', '1', 'STOCK', { cost: { amount: '20', currency: 'CNY', date: '2026-10-01', label: 'A' } }), posting('Assets:Bank', '-20')]),
      transaction('2026-10-02', 'B', [posting('Assets:Broker', '2', 'STOCK', { cost: { amount: '20', currency: 'CNY', date: '2026-10-02', label: 'B' } }), posting('Assets:Bank', '-40')]),
    ], { prices: [{ date: '2026-10-31', commodity: 'STOCK', amount: '25', currency: 'CNY' }] });
    expect(getAccounts(snapshot, '2026-10').positions.map(position => [position.units, position.costDate, position.costLabel])).toEqual([['1', '2026-10-01', 'A'], ['2', '2026-10-02', 'B']]);
  });

  it('does not treat a partially quoted portfolio as a complete net asset value', () => {
    const snapshot = ledger([
      transaction('2026-10-01', 'A', [posting('Assets:Broker', '1', 'STOCK', { cost: { amount: '20', currency: 'CNY' } }), posting('Assets:Bank', '-20')]),
      transaction('2026-10-02', 'B', [posting('Assets:Broker', '2', 'OTHER', { cost: { amount: '20', currency: 'CNY' } }), posting('Assets:Bank', '-40')]),
    ], { prices: [{ date: '2026-10-31', commodity: 'STOCK', amount: '25', currency: 'CNY' }] });
    expect(getAccounts(snapshot, '2026-10')).toMatchObject({ investments: null, netWorth: null });
  });

  it('uses a direct quote in its own currency and does not invent cross-currency profit', () => {
    const snapshot = ledger([transaction('2026-10-01', '外币成本', [posting('Assets:Broker', '2', 'STOCK', { cost: { amount: '20', currency: 'USD' } }), posting('Assets:USD', '-40', 'USD')])], { prices: [{ date: '2026-10-31', commodity: 'STOCK', amount: '160', currency: 'CNY' }, { date: '2026-10-31', commodity: 'STOCK', amount: '23', currency: 'USD' }] });
    const cny = getAccounts(snapshot, '2026-10', 'CNY').positions.find(position => position.currency === 'CNY');
    const usd = getAccounts(snapshot, '2026-10', 'USD').positions.find(position => position.currency === 'USD');
    expect(cny).toMatchObject({ cost: '40', costCurrency: 'USD', marketValue: '320', unrealizedPnl: null });
    expect(usd).toMatchObject({ costCurrency: 'USD', marketValue: '46', unrealizedPnl: '6' });
  });

  it('retains financial precision above eighty digits rather than using a fixed Decimal context', () => {
    const amount = `1${'0'.repeat(90)}.00000000000000000001`;
    const snapshot = ledger([transaction('2026-10-01', '高精度', [posting('Assets:Bank', amount), posting('Income:Salary', `-${amount}`)])]);
    expect(getOverview(snapshot, '2026-10').income).toBe(amount);
    expect(getAccounts(snapshot, '2026-10').cash).toBe(amount);
  });
});
