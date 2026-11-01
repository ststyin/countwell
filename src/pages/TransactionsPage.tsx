import { useEffect, useState } from 'react'
import { Search, X, Filter, CircleAlert } from 'lucide-react'
import { getTransactions } from '../domain'
import type { Ledger, TransactionKind } from '../domain/types'
import type { Route } from '../lib/route'
import TransactionList, { kindLabels } from '../components/TransactionList'

const kinds: (TransactionKind | 'all')[] = ['all', 'expense', 'income', 'refund', 'transfer', 'investment']

export default function TransactionsPage({ ledger, route, currency, onFilter }: { ledger: Ledger; route: Route; currency: string; onFilter: (patch: Partial<Route>, replace?: boolean) => void }) {
  const [visible, setVisible] = useState(20)
  const [pendingOnly, setPendingOnly] = useState(false)
  const all = getTransactions(ledger, { month: route.month, currency, search: route.search, kind: route.kind, account: route.account })
  const filtered = all.filter(tx => !pendingOnly || tx.flag === '!')
  const accounts = ledger.accounts.filter(a => a.kind !== 'equity')
  const hasFilters = Boolean(route.search || route.kind !== 'all' || route.account || pendingOnly)
  useEffect(() => setVisible(20), [route.month, route.search, route.kind, route.account, pendingOnly, currency])
  const clear = () => { onFilter({ search: '', kind: 'all', account: '' }, true); setPendingOnly(false) }
  return <section className="panel transactions-panel">
    <div className="transactions-toolbar"><label className="search-field"><Search size={18} className="search-icon" /><input aria-label="搜索交易" type="search" placeholder="搜索商户、备注或分类" value={route.search} onChange={e => onFilter({ search: e.target.value }, true)} />{route.search && <button className="icon-button" aria-label="清除搜索" onClick={() => onFilter({ search: '' }, true)}><X size={15} /></button>}</label><label className="account-filter"><Filter size={16} /><select aria-label="筛选账户" value={route.account} onChange={e => onFilter({ account: e.target.value }, true)}><option value="">所有账户</option>{accounts.map(account => <option key={account.name} value={account.name}>{account.label}</option>)}</select></label></div>
    <div className="filter-row"><div className="filter-tabs" aria-label="交易类型">{kinds.map(kind => <button className={`filter-chip ${route.kind === kind ? 'active' : ''}`} aria-pressed={route.kind === kind} key={kind} onClick={() => onFilter({ kind }, true)}>{kind === 'all' ? '全部记录' : kindLabels[kind]}</button>)}</div><label className="pending-filter"><input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} /><CircleAlert size={13} />仅待核对</label></div>
    <div className="filter-summary"><span>{filtered.length} 笔记录 <span className="mini-dot" />{currency}{route.account && <span className="selected-account">{ledger.accounts.find(a => a.name === route.account)?.label ?? route.account}</span>}</span>{hasFilters && <button className="clear-filters" onClick={clear}>清除筛选<X size={12} /></button>}</div>
    <TransactionList transactions={filtered.slice(0, visible)} />
    {filtered.length > visible && <div className="load-more"><button className="button" onClick={() => setVisible(v => v + 20)}>再看 20 笔<span>已显示 {visible} / {filtered.length}</span></button></div>}
    {!filtered.length && hasFilters && <div className="load-more"><button className="button" onClick={clear}>清除筛选，查看全部</button></div>}
  </section>
}
