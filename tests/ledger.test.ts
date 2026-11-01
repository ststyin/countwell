import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { getAccounts, getOverview, getTransactions, loadDemoLedger, monthBounds, parseDemoLedger } from '../src/domain';

const preamble = `
2026-01-01 open Assets:Bank
  display_name: "银行卡"
2026-01-01 open Assets:Cash
  display_name: "现金"
2026-01-01 open Assets:Broker
  countwell_role: "investment"
2026-01-01 open Liabilities:Card
2026-01-01 open Equity:Opening
2026-01-01 open Income:Salary
2026-01-01 open Expenses:Food
  display_name: "餐饮"
`;
const fixture = (body:string) => parseDemoLedger(preamble + body);

describe('bundled fictional ledger', () => {
  it('provides a full month of balanced, varied transactions with real daily totals', () => {
    const ledger = loadDemoLedger();
    const overview = getOverview(ledger,'2026-10');
    expect(ledger.title).toContain('虚构');
    expect(overview.transactionCount).toBeGreaterThanOrEqual(35);
    expect(overview.income).toBe('20432.42');
    expect(overview.expense).toBe('9682.57');
    expect(overview.surplus).toBe('10749.85');
    expect(overview.dailyExpenses).toHaveLength(31);
    expect(overview.dailyExpenses.reduce((sum,item) => sum.plus(item.amount),new Decimal(0)).toFixed()).toBe(overview.expense);
    expect(new Set(getTransactions(ledger,{month:'2026-10'}).map(item => item.kind))).toEqual(new Set(['income','expense','refund','transfer','investment']));
    expect(overview.pendingCount).toBe(2);
  });

  it('keeps USD separate rather than manufacturing a combined money total', () => {
    const ledger = loadDemoLedger();
    const report = getOverview(ledger,'2026-10','USD');
    expect(report.income).toBe('2.4');
    expect(report.expense).toBe('42.5');
    expect(report.surplus).toBe('-40.1');
    expect(report.currencies).toEqual(['CNY','USD']);
    expect(getAccounts(ledger,'2026-10','USD').cash).toBe('1159.9');
  });

  it('preserves snapshot data across reports, search, account filters, and historical queries', () => {
    const ledger = loadDemoLedger();
    const before = JSON.stringify(ledger);
    const overview = getOverview(ledger,'2026-10');
    const found = getTransactions(ledger,{month:'2026-10',search:'咖啡',account:'Assets:Alipay',kind:'expense'});
    expect(found.length).toBeGreaterThan(1);
    expect(found.every(item => item.postings.some(posting => posting.account === 'Assets:Alipay'))).toBe(true);
    getAccounts(ledger,'2026-08');
    expect(getOverview(ledger,'2026-10')).toEqual(overview);
    expect(JSON.stringify(ledger)).toBe(before);
  });
});

describe('friendly presentation over double-entry data', () => {
  const ledger = fixture(`
2026-09-30 * "Opening"
  Assets:Bank 1000 CNY
  Equity:Opening -1000 CNY
2026-10-01 * "Salary"
  Assets:Bank 100 CNY
  Income:Salary -100 CNY
2026-10-02 * "Dinner"
  Expenses:Food 80 CNY
  Assets:Bank -80 CNY
2026-10-03 * "Refund"
  Expenses:Food -20 CNY
  Assets:Bank 20 CNY
2026-10-04 * "Move cash"
  Assets:Cash 100 CNY
  Assets:Bank -100 CNY
2026-10-05 ! "Card purchase"
  Expenses:Food 60 CNY
  Liabilities:Card -60 CNY
2026-10-06 * "Card repayment"
  Liabilities:Card 50 CNY
  Assets:Bank -50 CNY
2026-11-01 * "Future dinner"
  Expenses:Food 999 CNY
  Assets:Bank -999 CNY
`);

  it('inverts income for display, deducts refunds, and excludes transfers and repayments from expenses', () => {
    const report = getOverview(ledger,'2026-10');
    expect(report.income).toBe('100');
    expect(report.expense).toBe('120');
    expect(report.surplus).toBe('-20');
    expect(report.dailyExpenses.find(item => item.date === '2026-10-03')?.amount).toBe('-20');
    const rows = getTransactions(ledger,{month:'2026-10'});
    expect(rows.find(item => item.narration === 'Dinner')).toMatchObject({kind:'expense',direction:'out',amount:'80'});
    expect(rows.find(item => item.narration === 'Refund')).toMatchObject({kind:'refund',direction:'in',amount:'20'});
    expect(rows.find(item => item.narration === 'Salary')).toMatchObject({kind:'income',direction:'in',amount:'100'});
    expect(rows.find(item => item.narration === 'Card repayment')).toMatchObject({kind:'transfer',direction:'internal',amount:'50'});
  });

  it('shows cash and money owed separately, without changing raw liability signs', () => {
    const report = getAccounts(ledger,'2026-10');
    expect(report.cash).toBe('990');
    expect(report.liabilities).toBe('10');
    expect(report.netWorth).toBe('980');
    expect(report.accounts.find(account => account.name === 'Liabilities:Card')?.balance).toBe('-10');
    expect(getAccounts(ledger,'2026-09').cash).toBe('1000');
  });

  it('uses all postings for exact account filtering and returns complete matching transactions', () => {
    const rows = getTransactions(ledger,{month:'2026-10',account:'Liabilities:Card'});
    expect(rows.map(item => item.narration)).toEqual(['Card repayment','Card purchase']);
    expect(rows.every(item => item.postings.length === 2)).toBe(true);
    expect(getTransactions(ledger,{month:'2026-10',search:'no match'})).toEqual([]);
  });

  it('separates overpaid credit balances from debt and includes them in net worth', () => {
    const overpaid = fixture(`
2026-10-01 * "Card overpayment"
  Liabilities:Card 25 CNY
  Equity:Opening -25 CNY
`);
    expect(getAccounts(overpaid,'2026-10')).toMatchObject({liabilities:'0',overpayments:'25',netWorth:'25'});
  });
});

describe('holdings and exact amounts', () => {
  it('values a historical cost lot only with prices on or before the selected month end', () => {
    const ledger = fixture(`
2026-09-01 commodity FUND
2026-09-01 * "Opening cash"
  Assets:Bank 1000 CNY
  Equity:Opening -1000 CNY
2026-10-02 * "Investment purchase"
  Assets:Broker 3 FUND {20 CNY}
  Assets:Bank -60 CNY
2026-10-31 price FUND 25 CNY
2026-11-01 price FUND 999 CNY
`);
    expect(getOverview(ledger,'2026-10').expense).toBe('0');
    const report = getAccounts(ledger,'2026-10');
    expect(report).toMatchObject({cash:'940',investments:'75',netWorth:'1015'});
    expect(report.positions[0]).toMatchObject({units:'3',cost:'60',unitCost:'20',price:'25',marketValue:'75',unrealizedPnl:'15'});
    expect(getAccounts(ledger,'2026-09').positions).toEqual([]);
  });

  it('does not silently substitute booked cost or a future quote for a missing market value', () => {
    const ledger = fixture(`
2026-10-02 * "No current quote"
  Assets:Broker 3 FUND {20 CNY}
  Assets:Bank -60 CNY
2026-11-01 price FUND 999 CNY
`);
    expect(getAccounts(ledger,'2026-10')).toMatchObject({investments:null,netWorth:null});
    expect(getAccounts(ledger,'2026-10').positions[0].marketValue).toBeNull();
  });

  it('retains decimal precision beyond binary floats through totals and balances', () => {
    const ledger = fixture(`
2026-10-01 * "Exact income"
  Assets:Bank 0.1000000000000000000000001 CNY
  Income:Salary -0.1000000000000000000000001 CNY
2026-10-02 * "Exact expense"
  Expenses:Food 0.0000000000000000000000001 CNY
  Assets:Bank -0.0000000000000000000000001 CNY
`);
    expect(getOverview(ledger,'2026-10').income).toBe('0.1000000000000000000000001');
    expect(getOverview(ledger,'2026-10').surplus).toBe('0.1');
    expect(getAccounts(ledger,'2026-10').cash).toBe('0.1');
  });
});

describe('bounded demo reader', () => {
  it('fails closed for unbalanced postings, unknown directives, plugins, and missing amounts', () => {
    expect(() => fixture('\n2026-10-01 * "Bad"\n  Assets:Bank 2 CNY\n  Income:Salary -1 CNY\n')).toThrow('不平衡');
    expect(() => fixture('\nplugin "anything"\n')).toThrow('未知或不支持');
    expect(() => fixture('\ninclude "other.beancount"\n')).toThrow('未知或不支持');
    expect(() => fixture('\n2026-10-01 * "No amount"\n  Assets:Bank\n  Income:Salary -1 CNY\n')).toThrow('分录语法');
  });

  it('validates dates and month boundaries, including leap years and empty months', () => {
    expect(monthBounds('2024-02')).toMatchObject({start:'2024-02-01',end:'2024-02-29',days:29});
    expect(monthBounds('2026-01').previous).toBe('2025-12');
    expect(() => monthBounds('2026-13')).toThrow();
    expect(() => monthBounds('0000-01')).toThrow();
    expect(() => fixture('\n2026-02-30 * "Invalid"\n  Assets:Bank 1 CNY\n  Income:Salary -1 CNY\n')).toThrow('日期无效');
    expect(getOverview(loadDemoLedger(),'2025-01')).toMatchObject({income:'0',expense:'0',surplus:'0',transactionCount:0});
  });
});
