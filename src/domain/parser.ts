import Decimal from 'decimal.js';
import type { AccountKind, Ledger, LedgerAccount, LedgerTransaction, Posting } from './types';

const D = Decimal.clone({ precision: 80 });
const number = '[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)';
const currency = '[A-Z][A-Z0-9._-]*';
const account = '[\\p{L}][\\p{L}\\p{N}_-]*(?::[\\p{L}\\p{N}_-]+)+';
const quoted = '"(?:[^"\\\\]|\\\\.)*"';
const postingPattern = new RegExp(`^\\s+(${account})\\s+(${number})\\s+(${currency})(?:\\s+\\{(${number})\\s+(${currency})\\})?\\s*$`, 'u');
const transactionPattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\s+([*!])\\s+(${quoted})(?:\\s+(${quoted}))?((?:\\s+#[\\p{L}\\p{N}_-]+)*)\\s*$`, 'u');
const roots: Record<string, AccountKind> = { Assets:'asset', Liabilities:'liability', Income:'income', Expenses:'expense', Equity:'equity' };

export class DemoLedgerError extends Error {
  constructor(message: string, line: number) {
    super(`演示账本第 ${line} 行：${message}`);
    this.name = 'DemoLedgerError';
  }
}

export function validateDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('日期无效');
  }
}

/**
 * A deliberately bounded reader for the bundled, fictional demo ledger.
 * Supports explicit, balanced postings and simple unit costs, not general
 * Beancount loading, booking, includes, plugins, interpolation, or assertions.
 * Unknown syntax fails closed instead of quietly producing partial reports.
 */
export function parseDemoLedger(source: string, defaultMonth = '2026-10'): Ledger {
  const ledger: Ledger = {title:'演示账本',source,defaultMonth,accounts:[],accountNames:[],transactions:[],prices:[],commodities:[]};
  const knownAccounts = new Map<string, LedgerAccount>();
  let current: LedgerTransaction | null = null;
  let openedAccount: LedgerAccount | null = null;
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);

  const finish = (line: number) => {
    if (!current) return;
    if (current.postings.length < 2) throw new DemoLedgerError('每笔交易至少需要两条分录', line);
    const weights = new Map<string, Decimal>();
    for (const posting of current.postings) {
      const unit = posting.cost?.currency ?? posting.currency;
      const weight = new D(posting.amount).times(posting.cost?.amount ?? '1');
      weights.set(unit, (weights.get(unit) ?? new D(0)).plus(weight));
    }
    if ([...weights.values()].some(value => !value.isZero())) throw new DemoLedgerError('交易分录不平衡，已拒绝生成报表', line);
    // The demo's activity row has one amount and one currency. Keep this
    // narrower contract explicit rather than adding unlike units or hiding a
    // currency when a valid Beancount transaction contains independent legs.
    if (weights.size > 1) throw new DemoLedgerError('演示不支持单笔多币种业务，请按币种拆分交易', line);
    ledger.transactions.push(current);
    current = null;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (!line.trim() || /^\s*;/.test(line)) continue;
    if (/^\s/.test(line)) {
      if (openedAccount && !current) {
        const metadata = line.match(new RegExp(`^\\s+(display_name|countwell_role):\\s+(${quoted})\\s*$`));
        if (!metadata) throw new DemoLedgerError('演示仅支持账户 display_name 和 countwell_role 元数据', lineNumber);
        const value: string = JSON.parse(metadata[2]);
        if (metadata[1] === 'display_name') openedAccount.label = value;
        else if (['cash','investment','other'].includes(value)) openedAccount.role = value as LedgerAccount['role'];
        else throw new DemoLedgerError('账户角色无效', lineNumber);
        continue;
      }
      const match = line.match(postingPattern);
      if (!current || !match) throw new DemoLedgerError('该分录语法不在演示支持范围内', lineNumber);
      if (!knownAccounts.has(match[1])) throw new DemoLedgerError('分录账户尚未声明', lineNumber);
      const posting: Posting = {account:match[1],amount:new D(match[2]).toFixed(),currency:match[3]};
      if (match[4]) {
        if (new D(match[4]).isNegative()) throw new DemoLedgerError('演示不支持负单位成本', lineNumber);
        posting.cost = {amount:new D(match[4]).toFixed(),currency:match[5]};
      }
      current.postings.push(posting);
      continue;
    }
    finish(lineNumber);
    openedAccount = null;
    const option = line.match(new RegExp(`^option\\s+"(title|operating_currency)"\\s+(${quoted})\\s*$`));
    if (option) {
      if (option[1] === 'title') ledger.title = JSON.parse(option[2]);
      continue;
    }
    const opening = line.match(new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\s+open\\s+(${account})(?:\\s+${currency}(?:,\\s*${currency})*)?\\s*$`, 'u'));
    if (opening) {
      try { validateDate(opening[1]); } catch { throw new DemoLedgerError('日期无效', lineNumber); }
      const kind = roots[opening[2].split(':')[0]];
      if (!kind || knownAccounts.has(opening[2])) throw new DemoLedgerError('账户根名称无效或重复声明', lineNumber);
      openedAccount = {name:opening[2],label:opening[2].split(':').at(-1)!,kind,role:kind === 'asset' ? 'cash' : 'other'};
      knownAccounts.set(openedAccount.name, openedAccount);
      ledger.accounts.push(openedAccount);
      continue;
    }
    const commodity = line.match(new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\s+commodity\\s+(${currency})\\s*$`));
    if (commodity) {
      try { validateDate(commodity[1]); } catch { throw new DemoLedgerError('日期无效', lineNumber); }
      ledger.commodities.push(commodity[2]);
      continue;
    }
    const price = line.match(new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\s+price\\s+(${currency})\\s+(${number})\\s+(${currency})\\s*$`));
    if (price) {
      try { validateDate(price[1]); } catch { throw new DemoLedgerError('日期无效', lineNumber); }
      if (!new D(price[3]).isPositive()) throw new DemoLedgerError('报价必须为正数', lineNumber);
      ledger.prices.push({date:price[1],commodity:price[2],amount:new D(price[3]).toFixed(),currency:price[4]});
      continue;
    }
    const transaction = line.match(transactionPattern);
    if (transaction) {
      try { validateDate(transaction[1]); } catch { throw new DemoLedgerError('日期无效', lineNumber); }
      current = {id:`tx-${lineNumber}`,date:transaction[1],flag:transaction[2] as '*'|'!',payee:transaction[4] ? JSON.parse(transaction[3]) : '',narration:JSON.parse(transaction[4] ?? transaction[3]),tags:transaction[5].trim() ? transaction[5].trim().split(/\s+/).map(tag => tag.slice(1)) : [],postings:[]};
      continue;
    }
    throw new DemoLedgerError('未知或不支持的语法；演示读取器不会跳过账本内容', lineNumber);
  }
  finish(lines.length);
  ledger.accountNames = ledger.accounts.map(item => item.name);
  // Stable chronological order, preserving source order on the same date.
  ledger.transactions.sort((a,b) => a.date.localeCompare(b.date));
  ledger.prices.sort((a,b) => a.date.localeCompare(b.date));
  return ledger;
}
