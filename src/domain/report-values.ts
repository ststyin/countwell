import Decimal from 'decimal.js';
import type { AccountKind, Ledger } from './types';

const defaultRoots = { assets: 'Assets', liabilities: 'Liabilities', income: 'Income', expenses: 'Expenses', equity: 'Equity' };
export const text = (value: Decimal) => value.isZero() ? '0' : value.toFixed();
export const label = (ledger: Ledger, name: string) => ledger.accounts.find(account => account.name === name)?.label ?? name.split(':').at(-1)!;

export function accountKind(ledger: Ledger, name: string): AccountKind | undefined {
  const explicit = ledger.accounts.find(account => account.name === name)?.kind;
  if (explicit) return explicit;
  const roots = ledger.roots ?? defaultRoots;
  const root = name.split(':')[0];
  return root === roots.assets ? 'asset' : root === roots.liabilities ? 'liability' : root === roots.income ? 'income' : root === roots.expenses ? 'expense' : root === roots.equity ? 'equity' : undefined;
}

export function isInvestmentGainAccount(name: string): boolean {
  return /(?:^|:)(?:CapitalGains?|Gains?|PnL|Profit|投资收益|投资损益|资本利得)(?::|$)/i.test(name);
}

export function isInvestmentFeeAccount(name: string): boolean {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1:$2').split(/[:_-]/);
  return parts.some(part => /^(fees?|commissions?|tax(?:es)?)$/i.test(part) || /(?:手续费|佣金|税)$/.test(part));
}

export function arithmetic(ledger: Ledger) {
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


export function costUnits(ledger: Ledger, end = '9999-12-31'): Set<string> {
  return new Set(ledger.transactions.filter(transaction => transaction.date <= end).flatMap(transaction => transaction.postings.filter(posting => posting.cost).map(posting => posting.currency)));
}
