import Decimal from 'decimal.js';
import type { AccountBalance, AccountReport, Activity, InvestmentPosition, Ledger, LedgerTransaction, Overview, Posting, TransactionQuery } from './types';

const D = Decimal.clone({ precision:80 });
const sum = (values: string[]) => values.reduce((total,value) => total.plus(value),new D(0));
const text = (value: Decimal) => value.isZero() ? '0' : value.toFixed();
const root = (posting: Posting) => posting.account.split(':')[0];
const label = (ledger: Ledger, name: string) => ledger.accounts.find(account => account.name === name)?.label ?? name.split(':').at(-1)!;

export function monthBounds(month: string): {start:string;end:string;days:number;previous:string} {
  if (typeof month !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份必须为 YYYY-MM');
  const [year,number] = month.split('-').map(Number);
  if (year === 0) throw new Error('年份必须大于零');
  const days = number === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4,6,9,11].includes(number) ? 30 : 31;
  const previous = number === 1 ? `${String(year-1).padStart(4,'0')}-12` : `${String(year).padStart(4,'0')}-${String(number-1).padStart(2,'0')}`;
  return {start:`${month}-01`,end:`${month}-${days}`,days,previous};
}

function moneyCurrencies(ledger: Ledger): string[] {
  return [...new Set(ledger.transactions.flatMap(transaction => transaction.postings.filter(posting => !posting.cost && !ledger.commodities.includes(posting.currency)).map(posting => posting.currency)))].sort((a,b) => a === 'CNY' ? -1 : b === 'CNY' ? 1 : a.localeCompare(b));
}

function totalForMonth(ledger: Ledger, month: string, currency: string) {
  const {start,end} = monthBounds(month);
  const transactions = ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end);
  let income = new D(0);
  let expense = new D(0);
  for (const transaction of transactions) {
    for (const posting of transaction.postings) {
      if (posting.currency !== currency) continue;
      if (root(posting) === 'Income') income = income.minus(posting.amount);
      if (root(posting) === 'Expenses') expense = expense.plus(posting.amount);
    }
  }
  return {income,expense,transactions};
}

/** Filtering affects transaction rows; full-month summary values stay unchanged. */
export function getOverview(ledger: Ledger, month: string, currency = 'CNY'): Overview {
  const {days,previous} = monthBounds(month);
  const current = totalForMonth(ledger,month,currency);
  const before = previous.startsWith('0000') ? {income:new D(0),expense:new D(0)} : totalForMonth(ledger,previous,currency);
  const daily = new Map(Array.from({length:days},(_,index) => [`${month}-${String(index+1).padStart(2,'0')}`,new D(0)]));
  const expenses = new Map<string,Decimal>();
  const incomes = new Map<string,Decimal>();
  for (const transaction of current.transactions) {
    for (const posting of transaction.postings) {
      if (posting.currency !== currency) continue;
      if (root(posting) === 'Expenses') {
        expenses.set(posting.account,(expenses.get(posting.account) ?? new D(0)).plus(posting.amount));
        daily.set(transaction.date,daily.get(transaction.date)!.plus(posting.amount));
      } else if (root(posting) === 'Income') {
        incomes.set(posting.account,(incomes.get(posting.account) ?? new D(0)).minus(posting.amount));
      }
    }
  }
  const categoryRows = (values:Map<string,Decimal>,total:Decimal) => [...values].map(([account,amount]) => ({account,name:label(ledger,account),amount:text(amount),share:total.isZero() ? 0 : amount.div(total).times(100).toNumber()})).sort((a,b) => new D(b.amount).cmp(a.amount));
  const change = (now:Decimal,prior:Decimal) => prior.isZero() ? null : now.minus(prior).div(prior.abs()).times(100).toNumber();
  return {
    month,currency,currencies:moneyCurrencies(ledger),income:text(current.income),expense:text(current.expense),surplus:text(current.income.minus(current.expense)),
    previousIncome:text(before.income),previousExpense:text(before.expense),previousSurplus:text(before.income.minus(before.expense)),
    incomeChange:change(current.income,before.income),expenseChange:change(current.expense,before.expense),
    transactionCount:current.transactions.length,pendingCount:current.transactions.filter(transaction => transaction.flag === '!').length,
    dailyExpenses:[...daily].map(([date,amount]) => ({date,amount:text(amount)})),categories:categoryRows(expenses,current.expense),incomeCategories:categoryRows(incomes,current.income),
  };
}

function activity(ledger: Ledger, transaction: LedgerTransaction): Activity {
  const income = transaction.postings.filter(posting => root(posting) === 'Income');
  const expense = transaction.postings.filter(posting => root(posting) === 'Expenses');
  const investments = transaction.postings.filter(posting => posting.cost);
  const assets = transaction.postings.filter(posting => root(posting) === 'Assets');
  const outgoing = assets.find(posting => new D(posting.amount).isNegative());
  const incoming = assets.find(posting => new D(posting.amount).isPositive());
  let kind:Activity['kind'];
  let direction:Activity['direction'];
  let category:string;
  let amount:Decimal;
  let currency:string;
  if (income.length) {
    kind = 'income';
    const signed = sum(income.map(posting => posting.amount)).negated();
    direction = signed.isNegative() ? 'out' : 'in';
    category = signed.isNegative() ? '收入冲回' : income.length === 1 ? label(ledger,income[0].account) : '多项收入';
    amount = signed.abs();
    currency = income[0].currency;
  } else if (expense.length) {
    const signed = sum(expense.map(posting => posting.amount));
    kind = signed.isNegative() ? 'refund' : 'expense';
    direction = signed.isNegative() ? 'in' : 'out';
    category = expense.length === 1 ? label(ledger,expense[0].account) : '多项支出';
    amount = signed.abs();
    currency = expense[0].currency;
  } else if (investments.length) {
    kind = 'investment';direction = 'internal';category = '投资买入';
    amount = sum(investments.map(posting => new D(posting.amount).times(posting.cost!.amount).toFixed())).abs();
    currency = investments[0].cost!.currency;
    if (investments.every(posting => new D(posting.amount).isNegative())) category = '投资卖出';
  } else {
    kind = 'transfer';direction = 'internal';category = '账户转账';
    const representative = incoming ?? outgoing ?? transaction.postings[0];
    amount = new D(representative.amount).abs();currency = representative.currency;
    if (transaction.postings.some(posting => root(posting) === 'Liabilities')) category = '信用卡还款';
    if (transaction.postings.some(posting => root(posting) === 'Equity')) category = '期初余额';
  }
  const representative = outgoing ?? incoming ?? transaction.postings[0];
  return {...transaction,kind,direction,category,amount:text(amount),currency,account:representative.account,accountLabel:label(ledger,representative.account),fromAccount:outgoing?.account,toAccount:incoming?.account};
}

export function getTransactions(ledger: Ledger, query:TransactionQuery): Activity[] {
  const {start,end} = monthBounds(query.month);
  const search = query.search?.toLowerCase() ?? '';
  return ledger.transactions.filter(transaction => transaction.date >= start && transaction.date <= end)
    .map(transaction => activity(ledger,transaction))
    .filter(item => (!query.kind || query.kind === 'all' || query.kind === item.kind)
      && (!query.account || query.account === 'all' || item.postings.some(posting => posting.account === query.account))
      && (!query.currency || item.currency === query.currency)
      && (!search || `${item.payee}\n${item.narration}\n${item.category}\n${item.accountLabel}\n${item.postings.map(posting => label(ledger,posting.account)).join('\n')}`.toLowerCase().includes(search)))
    .reverse();
}

/** Values are independently reported for each currency, with no implicit FX. */
export function getAccounts(ledger: Ledger, month:string, currency = 'CNY'): AccountReport {
  const {start,end} = monthBounds(month);
  const balances = new Map<string,{account:string;currency:string;opening:Decimal;closing:Decimal}>();
  const lots = new Map<string,{account:string;commodity:string;currency:string;unitCost:string;units:Decimal}>();
  const commodityNames = new Set([...ledger.commodities,...ledger.transactions.flatMap(transaction => transaction.postings.filter(posting => posting.cost).map(posting => posting.currency))]);
  for (const transaction of ledger.transactions) {
    if (transaction.date > end) continue;
    for (const posting of transaction.postings) {
      if (!['Assets','Liabilities'].includes(root(posting))) continue;
      if (posting.cost) {
        const key = `${posting.account}\0${posting.currency}\0${posting.cost.currency}\0${posting.cost.amount}`;
        const lot = lots.get(key) ?? {account:posting.account,commodity:posting.currency,currency:posting.cost.currency,unitCost:posting.cost.amount,units:new D(0)};
        lot.units = lot.units.plus(posting.amount);lots.set(key,lot);
      } else if (!commodityNames.has(posting.currency)) {
        const key = `${posting.account}\0${posting.currency}`;
        const balance = balances.get(key) ?? {account:posting.account,currency:posting.currency,opening:new D(0),closing:new D(0)};
        balance.closing = balance.closing.plus(posting.amount);
        if (transaction.date < start) balance.opening = balance.opening.plus(posting.amount);
        balances.set(key,balance);
      }
    }
  }
  const accounts:AccountBalance[] = [...balances.values()].map(balance => {
    const account = ledger.accounts.find(item => item.name === balance.account)!;
    return {name:account.name,label:account.label,kind:account.kind as 'asset'|'liability',role:account.role,balance:text(balance.closing),opening:text(balance.opening),change:text(balance.closing.minus(balance.opening)),currency:balance.currency};
  }).sort((a,b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));
  const positions:InvestmentPosition[] = [...lots.values()].filter(lot => !lot.units.isZero()).map(lot => {
    const quote = ledger.prices.filter(price => price.commodity === lot.commodity && price.currency === lot.currency && price.date <= end).at(-1);
    const cost = lot.units.times(lot.unitCost);
    const value = quote ? lot.units.times(quote.amount) : null;
    return {account:lot.account,accountLabel:label(ledger,lot.account),commodity:lot.commodity,units:text(lot.units),currency:lot.currency,cost:text(cost),unitCost:lot.unitCost,price:quote?.amount ?? null,priceDate:quote?.date ?? null,marketValue:value === null ? null : text(value),unrealizedPnl:value === null ? null : text(value.minus(cost))};
  });
  const selected = accounts.filter(account => account.currency === currency);
  const selectedPositions = positions.filter(position => position.currency === currency);
  const cash = sum(selected.filter(account => account.kind === 'asset').map(account => account.balance));
  const previousCash = sum(selected.filter(account => account.kind === 'asset').map(account => account.opening));
  const liabilities = sum(selected.filter(account => account.kind === 'liability').map(account => D.max(new D(account.balance).negated(),0).toFixed()));
  const overpayments = sum(selected.filter(account => account.kind === 'liability').map(account => D.max(account.balance,0).toFixed()));
  const investments = selectedPositions.some(position => position.marketValue === null) ? null : sum(selectedPositions.map(position => position.marketValue!));
  const signedLiabilities = sum(selected.filter(account => account.kind === 'liability').map(account => account.balance));
  return {month,currency,currencies:moneyCurrencies(ledger),cash:text(cash),investments:investments === null ? null : text(investments),liabilities:text(liabilities),overpayments:text(overpayments),netWorth:investments === null ? null : text(cash.plus(investments).plus(signedLiabilities)),previousCash:text(previousCash),cashChange:text(cash.minus(previousCash)),accounts,positions};
}
