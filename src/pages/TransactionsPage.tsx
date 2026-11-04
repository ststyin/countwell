import { useEffect, useState } from 'react'
import { Search, X, Filter, CircleAlert } from 'lucide-react'
import { getCreditCardSpendingTransactions, getPaymentAccountSpendingTransactions, getReceivingAccountIncomeTransactions, getTransactions } from '../domain'
import type { BillingCycle, Ledger, TransactionKind } from '../domain/types'
import type { Route } from '../lib/route'
import TransactionList, { kindLabels } from '../components/TransactionList'
import { accountLabels } from '../lib/accountLabels'

const kinds: (TransactionKind | 'all')[] = ['all', 'expense', 'income', 'refund', 'transfer', 'investment']

export default function TransactionsPage({ ledger, route, currency, cycle, onFilter }: { ledger: Ledger; route: Route; currency: string; cycle?: BillingCycle; onFilter: (patch: Partial<Route>, replace?: boolean) => void }) {
  const [visible, setVisible] = useState(20)
  const [pendingOnly, setPendingOnly] = useState(false)
  const selectedAccount = ledger.accounts.find(account => account.name === route.account)
  const financialAccount = selectedAccount?.kind === 'asset' || selectedAccount?.kind === 'liability'
  const paymentCurrency = route.incomeCurrency ?? route.paymentCurrency ?? route.cardCurrency
  const all = route.incomeCurrency && route.account
    ? getReceivingAccountIncomeTransactions(ledger, { month: route.allTime ? undefined : route.month, date: route.date, cycle, search: route.search, account: route.account, currency: route.incomeCurrency })
    : route.paymentCurrency && route.account
    ? getPaymentAccountSpendingTransactions(ledger, { month: route.allTime ? undefined : route.month, date: route.date, cycle, search: route.search, account: route.account, currency: route.paymentCurrency })
    : route.cardCurrency && route.account
    ? getCreditCardSpendingTransactions(ledger, { month: route.allTime ? undefined : route.month, date: route.date, cycle, search: route.search, account: route.account, currency: route.cardCurrency })
    : getTransactions(ledger, { month: route.allTime ? undefined : route.month, date: route.date, currency: financialAccount || route.date ? undefined : currency, cycle, search: route.search, kind: route.kind, account: route.account })
  const filtered = all.filter(tx => (!paymentCurrency || route.kind === 'all' || tx.kind === route.kind) && (!pendingOnly || tx.flag === '!'))
  const accounts = ledger.accounts.filter(a => a.kind !== 'equity')
  const labels = accountLabels(ledger.accounts)
  const hasFilters = Boolean(route.search || route.kind !== 'all' || route.account || route.date || paymentCurrency || pendingOnly)
  useEffect(() => setVisible(20), [route.month, route.allTime, route.date, route.search, route.kind, route.account, paymentCurrency, pendingOnly, currency, cycle])
  const clear = () => { onFilter({ search: '', kind: 'all', account: '', date: undefined, cardCurrency: undefined, paymentCurrency: undefined, incomeCurrency: undefined }, true); setPendingOnly(false) }
  return <section className="panel transactions-panel">
    <div className="transactions-toolbar"><label className="search-field"><Search size={18} className="search-icon" /><span className="field-frame"><input aria-label="搜索交易" type="search" placeholder="搜索交易" value={route.search} onChange={e => onFilter({ search: e.target.value }, true)} /></span>{route.search && <button className="icon-button" aria-label="清除搜索" onClick={() => onFilter({ search: '' }, true)}><X size={15} /></button>}</label><label className="account-filter"><Filter size={16} /><span className="field-frame"><select aria-label="筛选账户" value={route.account} onChange={e => onFilter({ account: e.target.value, cardCurrency: undefined, paymentCurrency: undefined, incomeCurrency: undefined }, true)}><option value="">所有账户</option>{accounts.map(account => <option key={account.name} value={account.name}>{labels.get(account.name) ?? account.label}</option>)}</select></span></label></div>
    <div className="filter-row"><div className="filter-tabs" aria-label="交易类型">{kinds.map(kind => <button className={`filter-chip ${route.kind === kind && !paymentCurrency ? 'active' : ''}`} aria-pressed={route.kind === kind && !paymentCurrency} key={kind} onClick={() => onFilter({ kind, cardCurrency: undefined, paymentCurrency: undefined, incomeCurrency: undefined }, true)}>{kind === 'all' ? '全部' : kindLabels[kind]}</button>)}</div><label className="pending-filter"><input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} /><CircleAlert size={13} />仅待核对</label></div>
    <div className="filter-summary"><span>{filtered.length} 笔记录{paymentCurrency && <span className="selected-account">{route.incomeCurrency ? '收入与收入冲回' : route.paymentCurrency ? '支出与退款' : '信用卡消费与退款'} · {paymentCurrency}</span>}{!paymentCurrency && currency !== 'CNY' && <><span className="mini-dot" />{currency}</>}{route.date && <span className="selected-account">{route.date}</span>}{route.account && <span className="selected-account">{labels.get(route.account) ?? route.account}</span>}</span>{hasFilters && <button className="clear-filters" onClick={clear}>清除筛选<X size={12} /></button>}</div>
    <TransactionList transactions={filtered.slice(0, visible)} />
    {filtered.length > visible && <div className="load-more"><button className="button" onClick={() => setVisible(v => v + 20)}>加载更多<span>{visible} / {filtered.length}</span></button></div>}
    {!filtered.length && hasFilters && <div className="load-more"><button className="button" onClick={clear}>清除筛选</button></div>}
  </section>
}
