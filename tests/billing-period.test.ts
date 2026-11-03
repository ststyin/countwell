import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { billingMonthForDate, getAccounts, getOverview, getTransactions, monthBounds, parseDemoLedger, reportPeriod } from '../src/domain';
import type { BillingCycle } from '../src/domain';

const custom = (day: number, boundary: BillingCycle['boundary'] = 'start'): BillingCycle => ({ mode: 'custom', day, boundary });

const preamble = `
2020-01-01 open Assets:Bank
2020-01-01 open Assets:Broker
  countwell_role: "investment"
2020-01-01 open Liabilities:Card
2020-01-01 open Equity:Opening
2020-01-01 open Income:Salary
2020-01-01 open Expenses:Food
`;
const fixture = (body: string) => parseDemoLedger(preamble + body);

describe('recurring reporting periods', () => {
  it('supports independent inclusive start and end days, including short months and overlapping or skipped dates', () => {
    const range = (startDay: number, endDay: number): BillingCycle => ({ mode: 'range', day: 1, boundary: 'start', startDay, endDay });
    expect(reportPeriod('2026-11', range(20, 25))).toMatchObject({ start: '2026-10-20', end: '2026-11-25' });
    expect(reportPeriod('2026-12', range(20, 25)).start).toBe('2026-11-20');
    expect(reportPeriod('2026-11', range(28, 20))).toMatchObject({ start: '2026-10-28', end: '2026-11-20' });
    expect(reportPeriod('2024-03', range(31, 30))).toMatchObject({ start: '2024-02-29', end: '2024-03-30' });
    expect(reportPeriod('2023-03', range(31, 31))).toMatchObject({ start: '2023-02-28', end: '2023-03-31' });
    expect(reportPeriod('2026-01', range(25, 10))).toMatchObject({ start: '2025-12-25', end: '2026-01-10' });
    expect(billingMonthForDate('2026-11-22', range(20, 25))).toBe('2026-11');
    expect(billingMonthForDate('2026-11-23', range(28, 20))).toBe('2026-12');
    for (const invalid of [0, 32, 2.5]) expect(() => reportPeriod('2026-11', range(invalid, 25))).toThrow('账单周期');
  });
  it('keeps natural months as the default, including Gregorian leap-year rules', () => {
    for (const month of ['2026-11', '2024-02', '1900-02', '2000-02']) {
      const period = reportPeriod(month);
      expect(period).toMatchObject(monthBounds(month));
      expect(period.dates).toHaveLength(period.days);
      expect(period.dates[0]).toBe(period.start);
      expect(period.dates.at(-1)).toBe(period.end);
    }
    expect(reportPeriod('1900-02').days).toBe(28);
    expect(reportPeriod('2000-02').days).toBe(29);
    expect(reportPeriod('9999-12').end).toBe('9999-12-31');
  });

  it('assigns the anchor to exactly one adjacent period for both boundary choices', () => {
    expect(reportPeriod('2026-11', custom(25))).toMatchObject({ start: '2026-10-25', end: '2026-11-24', days: 31, previous: '2026-10' });
    expect(reportPeriod('2026-12', custom(25))).toMatchObject({ start: '2026-11-25', end: '2026-12-24', days: 30 });
    expect(reportPeriod('2026-11', custom(25, 'end'))).toMatchObject({ start: '2026-10-26', end: '2026-11-25', days: 31 });
    expect(reportPeriod('2026-01', custom(25))).toMatchObject({ start: '2025-12-25', end: '2026-01-24' });
  });

  it('clamps short-month anchors and covers every date once across leap February', () => {
    const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05'];
    for (const day of [1, 25, 29, 30, 31]) for (const boundary of ['start', 'end'] as const) {
      const periods = months.map(month => reportPeriod(month, custom(day, boundary)));
      const dates = periods.flatMap(period => period.dates);
      expect(new Set(dates).size).toBe(dates.length);
      for (let index = 1; index < dates.length; index++) {
        const previous = new Date(dates[index - 1] + 'T00:00:00Z');
        previous.setUTCDate(previous.getUTCDate() + 1);
        expect(previous.toISOString().slice(0, 10)).toBe(dates[index]);
      }
    }
    expect(reportPeriod('2024-02', custom(31))).toMatchObject({ start: '2024-01-31', end: '2024-02-28' });
    expect(reportPeriod('2024-03', custom(31))).toMatchObject({ start: '2024-02-29', end: '2024-03-30' });
    expect(reportPeriod('2023-03', custom(31))).toMatchObject({ start: '2023-02-28', end: '2023-03-30' });
    expect(reportPeriod('2024-02', custom(31, 'end'))).toMatchObject({ start: '2024-02-01', end: '2024-02-29' });
    expect(reportPeriod('0099-03', custom(31))).toMatchObject({ start: '0099-02-28', end: '0099-03-30' });
  });

  it('rejects invalid boundaries and anchors instead of constructing a different period', () => {
    for (const day of [0, 32, 2.5, NaN]) expect(() => reportPeriod('2026-11', custom(day))).toThrow('账单周期');
    expect(() => reportPeriod('2026-13', custom(25))).toThrow('月份');
    expect(() => reportPeriod('0001-01', custom(25))).toThrow();
    expect(() => reportPeriod('2026-11', { ...custom(25), boundary: 'invalid' } as unknown as BillingCycle)).toThrow('账单周期');
  });
});

describe('billing month for a ledger date', () => {
  it('keeps calendar dates in their natural month and rejects nonexistent or malformed dates', () => {
    expect(billingMonthForDate('2026-10-31')).toBe('2026-10');
    expect(billingMonthForDate('2024-02-29')).toBe('2024-02');
    expect(billingMonthForDate('0001-01-01')).toBe('0001-01');
    for (const invalid of ['2026-02-29', '2024-02-30', '2026-11-31', '2026-10-00', '2026-13-01', '0000-01-01', '2026-1-01', '2026-01-1', '2026-01-01T00:00:00Z']) {
      expect(() => billingMonthForDate(invalid)).toThrow();
    }
  });

  it('selects the containing cycle on either side of the chosen boundary', () => {
    expect(billingMonthForDate('2026-10-24', custom(25))).toBe('2026-10');
    expect(billingMonthForDate('2026-10-25', custom(25))).toBe('2026-11');
    expect(billingMonthForDate('2026-10-31', custom(25))).toBe('2026-11');
    expect(billingMonthForDate('2026-11-25', custom(25, 'end'))).toBe('2026-11');
    expect(billingMonthForDate('2026-11-26', custom(25, 'end'))).toBe('2026-12');
    expect(billingMonthForDate('2026-12-31', custom(25))).toBe('2027-01');
    expect(billingMonthForDate('0099-12-31', custom(25))).toBe('0100-01');
  });

  it('uses the same clamped anchors across short months, leap years and year rollover', () => {
    expect(billingMonthForDate('2024-02-28', custom(31))).toBe('2024-02');
    expect(billingMonthForDate('2024-02-29', custom(31))).toBe('2024-03');
    expect(billingMonthForDate('2023-02-28', custom(31))).toBe('2023-03');
    expect(billingMonthForDate('2024-02-29', custom(31, 'end'))).toBe('2024-02');
    expect(billingMonthForDate('2024-03-01', custom(31, 'end'))).toBe('2024-03');
    for (const day of [1, 25, 29, 30, 31]) for (const boundary of ['start', 'end'] as const) {
      const cycle = custom(day, boundary);
      for (const date of ['2023-12-31', '2024-01-01', '2024-02-28', '2024-02-29', '2024-03-01', '2024-12-31']) {
        const selected = reportPeriod(billingMonthForDate(date, cycle), cycle);
        expect(selected.start <= date && selected.end >= date).toBe(true);
      }
    }
  });
});

describe('billing-period financial reports', () => {
  const ledger = fixture(`
2026-09-25 * "Previous start"
  Expenses:Food 20 CNY
  Assets:Bank -20 CNY
2026-10-24 * "Before new period"
  Expenses:Food 9 CNY
  Assets:Bank -9 CNY
2026-10-25 * "Anchor purchase"
  Expenses:Food 10 CNY
  Assets:Bank -10 CNY
2026-10-26 * "Salary"
  Assets:Bank 100 CNY
  Income:Salary -100 CNY
2026-10-30 * "Foreign purchase"
  Expenses:Food 11 USD
  Assets:Bank -11 USD
2026-11-24 ! "Refund"
  Expenses:Food -3 CNY
  Assets:Bank 3 CNY
2026-11-25 * "Next start"
  Expenses:Food 40 CNY
  Assets:Bank -40 CNY
2026-12-01 * "Later purchase"
  Expenses:Food 80 CNY
  Assets:Bank -80 CNY
`);

  it('uses one start-boundary range for totals, daily bars, categories, comparison and transaction counts', () => {
    const cycle = custom(25);
    const overview = getOverview(ledger, '2026-11', 'CNY', cycle);
    const transactions = getTransactions(ledger, { month: '2026-11', currency: 'CNY', cycle });
    expect(overview).toMatchObject({ income: '100', expense: '7', surplus: '93', previousExpense: '29', transactionCount: 3, pendingCount: 1 });
    expect(transactions.map(transaction => transaction.narration)).toEqual(['Refund', 'Salary', 'Anchor purchase']);
    expect(overview.dailyExpenses[0].date).toBe('2026-10-25');
    expect(overview.dailyExpenses.at(-1)?.date).toBe('2026-11-24');
    expect(overview.dailyExpenses.reduce((sum, day) => sum.plus(day.amount), new Decimal(0)).toFixed()).toBe(overview.expense);
    expect(overview.categories.map(category => category.amount)).toEqual(['7']);
    expect(overview.transactionCount).toBe(transactions.length);
    expect(getOverview(ledger, '2026-11', 'USD', cycle)).toMatchObject({ expense: '11', transactionCount: 1 });
  });

  it('uses both independently selected dates for the overview and transaction list', () => {
    const cycle: BillingCycle = { mode: 'range', day: 1, boundary: 'start', startDay: 26, endDay: 25 };
    const overview = getOverview(ledger, '2026-11', 'CNY', cycle);
    expect(overview).toMatchObject({ income: '100', expense: '37', transactionCount: 3 });
    expect(getTransactions(ledger, { month: '2026-11', currency: 'CNY', cycle }).map(transaction => transaction.narration)).toEqual(['Next start', 'Refund', 'Salary']);
  });

  it('uses an inclusive end anchor consistently, without duplicating its transactions next period', () => {
    const cycle = custom(25, 'end');
    const overview = getOverview(ledger, '2026-11', 'CNY', cycle);
    expect(overview).toMatchObject({ income: '100', expense: '37', previousExpense: '19', transactionCount: 3 });
    const current = getTransactions(ledger, { month: '2026-11', cycle });
    const next = getTransactions(ledger, { month: '2026-12', cycle });
    expect(current.find(transaction => transaction.narration === 'Anchor purchase')).toBeUndefined();
    expect(current.find(transaction => transaction.narration === 'Next start')).toBeDefined();
    expect(next.find(transaction => transaction.narration === 'Next start')).toBeUndefined();
    expect(current.filter(transaction => next.some(candidate => candidate.id === transaction.id))).toEqual([]);
  });

  it('uses period endpoints for optional account balance comparisons without changing all-time balances', () => {
    expect(getAccounts(ledger, '2026-11', 'CNY', custom(25))).toMatchObject({ cash: '64', previousCash: '-29', cashChange: '93' });
    expect(getAccounts(ledger, '2026-11', 'CNY', custom(25, 'end')).cash).toBe('24');
    expect(getAccounts(ledger).cash).toBe('-56');
  });
});

describe('all-time account history and current balances', () => {
  const ledger = fixture(`
2026-09-01 * "Opening"
  Assets:Bank 1000 CNY
  Equity:Opening -1000 CNY
2026-10-02 * "Purchase"
  Assets:Broker 3 FUND {20 CNY}
  Assets:Bank -60 CNY
2026-10-31 price FUND 25 CNY
2026-11-01 * "Later expense"
  Expenses:Food 100 CNY
  Assets:Bank -100 CNY
2030-11-01 price FUND 40 CNY
2031-01-01 * "Future source entry"
  Assets:Bank 500 CNY
  Income:Salary -500 CNY
2031-01-02 * "Foreign source entry"
  Assets:Bank 12 USD
  Equity:Opening -12 USD
`);

  it('includes every source posting and the newest source quote, regardless of the displayed report month', () => {
    expect(getAccounts(ledger, '2026-10')).toMatchObject({ cash: '940', investments: '75', netWorth: '1015' });
    const current = getAccounts(ledger);
    expect(current).toMatchObject({ month: '', cash: '1340', investments: '120', netWorth: '1460' });
    expect(current.positions[0]).toMatchObject({ priceDate: '2030-11-01', units: '3', marketValue: '120' });
    expect(current.accounts.find(account => account.currency === 'USD')).toMatchObject({ balance: '12', currency: 'USD' });
    expect(getAccounts(ledger, undefined, 'USD').cash).toBe('12');
    getOverview(ledger, '2026-09', 'CNY', custom(25));
    expect(getAccounts(ledger)).toEqual(current);
  });

  it('can inspect exact account history across all dates while retaining search and currency filters', () => {
    const all = getTransactions(ledger, { account: 'Assets:Bank' });
    expect(all).toHaveLength(5);
    expect(all[0].date).toBe('2031-01-02');
    expect(all.at(-1)?.date).toBe('2026-09-01');
    expect(all.every(transaction => transaction.postings.some(posting => posting.account === 'Assets:Bank'))).toBe(true);
    expect(getTransactions(ledger, { account: 'Assets:Bank', currency: 'USD' })).toHaveLength(1);
    expect(getTransactions(ledger, { account: 'Assets:Bank', search: 'Future source' })).toHaveLength(1);
    expect(getTransactions(ledger, { month: '2026-10', account: 'Assets:Bank' })).toHaveLength(1);
  });
});
