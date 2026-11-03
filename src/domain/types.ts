/** Money stays decimal text throughout the data model, including JSON exports. */
export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';
export type TransactionKind = 'income' | 'expense' | 'refund' | 'transfer' | 'investment';

/** Custom cycles are named for the month containing their ending anchor. */
export interface BillingCycle {
  mode: 'calendar' | 'custom';
  day: number;
  boundary: 'start' | 'end';
}

/** Both date endpoints are inclusive; adjacent periods never share a date. */
export interface ReportingPeriod {
  start: string;
  end: string;
  days: number;
  previous: string;
  dates: string[];
}

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
  cost?: { amount: string; currency: string; date?: string | null; label?: string | null };
  price?: { amount: string; currency: string };
  weight?: { amount: string; currency: string };
  flag?: string | null;
}

export interface LedgerTransaction {
  id: string;
  date: string;
  payee: string;
  narration: string;
  flag: string;
  tags: string[];
  links?: string[];
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
  roots?: { assets: string; liabilities: string; income: string; expenses: string; equity: string };
  operatingCurrencies?: string[];
  files?: { path: string; content: string }[];
  loadedAt?: string;
  engine?: { name: string; version: string };
}

export interface ActivityAmount {
  amount: string;
  currency: string;
  direction: 'in' | 'out' | 'internal';
  kind: TransactionKind;
  /** Weight displays explain cost/price transactions; they are not cash flow. */
  basis: 'units' | 'weight';
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
  amounts?: ActivityAmount[];
  amountBasis?: 'units' | 'weight';
  /** A transaction can be shown even when its card-specific amount is ambiguous. */
  amountUnavailable?: boolean;
}

export interface CreditCardSpending {
  account: string;
  currency: string;
  amount: string | null;
  transactionCount: number;
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
  flowSupported: boolean;
  previousFlowSupported: boolean;
  warnings: string[];
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
  cost: string | null;
  unitCost: string | null;
  costCurrency?: string | null;
  costDate?: string | null;
  costLabel?: string | null;
  price: string | null;
  priceDate: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  status?: 'ok' | 'missing_price' | 'invalid_price' | 'unsupported_pair';
}

export interface AccountReport {
  month: string;
  currency: string;
  currencies: string[];
  cash: string;
  otherAssets?: string;
  investments: string | null;
  liabilities: string;
  overpayments: string;
  netWorth: string | null;
  previousCash: string;
  cashChange: string;
  accounts: AccountBalance[];
  positions: InvestmentPosition[];
  warnings?: string[];
}

export interface TransactionQuery {
  /** Omit month to inspect the full account history. */
  month?: string;
  date?: string;
  cycle?: BillingCycle;
  search?: string;
  kind?: TransactionKind | 'all';
  account?: string;
  currency?: string;
}
