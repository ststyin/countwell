/** Money stays decimal text throughout the data model, including JSON exports. */
export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';
export type TransactionKind = 'income' | 'expense' | 'refund' | 'transfer' | 'investment';

export interface LedgerAccount {
  name: string;
  label: string;
  kind: AccountKind;
  role: 'cash' | 'investment' | 'other';
}

export interface Posting {
  account: string;
  amount: string;
  currency: string;
  cost?: { amount: string; currency: string };
}

export interface LedgerTransaction {
  id: string;
  date: string;
  payee: string;
  narration: string;
  flag: '*' | '!';
  tags: string[];
  postings: Posting[];
}

export interface PriceQuote {
  date: string;
  commodity: string;
  amount: string;
  currency: string;
}

export interface Ledger {
  title: string;
  source: string;
  defaultMonth: string;
  accounts: LedgerAccount[];
  accountNames: string[];
  transactions: LedgerTransaction[];
  prices: PriceQuote[];
  commodities: string[];
}

export interface Activity extends LedgerTransaction {
  kind: TransactionKind;
  direction: 'in' | 'out' | 'internal';
  category: string;
  /** Non-negative display quantity; direction and kind carry its meaning. */
  amount: string;
  currency: string;
  /** Canonical source account, useful for exact filtering. */
  account: string;
  accountLabel: string;
  fromAccount?: string;
  toAccount?: string;
}

export interface CategoryTotal {
  account: string;
  name: string;
  amount: string;
  /** Percent of this currency's net expense total. */
  share: number;
}

export interface Overview {
  month: string;
  currency: string;
  currencies: string[];
  income: string;
  expense: string;
  surplus: string;
  previousIncome: string;
  previousExpense: string;
  previousSurplus: string;
  incomeChange: number | null;
  expenseChange: number | null;
  transactionCount: number;
  pendingCount: number;
  dailyExpenses: { date: string; amount: string }[];
  categories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
}

export interface AccountBalance {
  name: string;
  label: string;
  kind: 'asset' | 'liability';
  role: 'cash' | 'investment' | 'other';
  balance: string;
  opening: string;
  change: string;
  currency: string;
}

export interface InvestmentPosition {
  account: string;
  accountLabel: string;
  commodity: string;
  units: string;
  currency: string;
  /** Total booked cost of this lot, never the purchase cash flow. */
  cost: string;
  unitCost: string;
  price: string | null;
  priceDate: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
}

export interface AccountReport {
  month: string;
  currency: string;
  currencies: string[];
  cash: string;
  investments: string | null;
  liabilities: string;
  overpayments: string;
  netWorth: string | null;
  previousCash: string;
  cashChange: string;
  accounts: AccountBalance[];
  positions: InvestmentPosition[];
}

export interface TransactionQuery {
  month: string;
  search?: string;
  kind?: TransactionKind | 'all';
  account?: string;
  currency?: string;
}
