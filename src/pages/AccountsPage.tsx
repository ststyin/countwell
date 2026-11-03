import Decimal from 'decimal.js'
import { useContext, useEffect, useRef } from 'react'
import { Building2, ChevronRight, CreditCard, Landmark, TrendingUp, Wallet } from 'lucide-react'
import { getAccounts } from '../domain'
import type { InvestmentPosition, Ledger } from '../domain/types'
import { DisplayContext, EmptyState, Money, SectionTitle } from '../components/ui'
import { shortDate } from '../lib/format'

export default function AccountsPage({ ledger, currency, onAccount, section }: { ledger: Ledger; currency: string; onAccount: (account: string) => void; section?: 'cash' | 'debt' }) {
  const cashRef = useRef<HTMLElement>(null)
  const debtRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (section) (section === 'cash' ? cashRef : debtRef).current?.scrollIntoView({ block: 'start' })
  }, [section])
  const report = getAccounts(ledger, undefined, currency)
  const { hidden } = useContext(DisplayContext)
  const cash = report.accounts.filter(account => account.kind === 'asset' && account.role === 'cash')
  const otherAssets = report.accounts.filter(account => account.kind === 'asset' && account.role === 'other')
  const debts = report.accounts.filter(account => account.kind === 'liability' && account.role !== 'investment')
  const positionsByLot = new Map<string, InvestmentPosition>()
  for (const position of report.positions) {
    const key = JSON.stringify([position.account, position.commodity, position.unitCost, position.costCurrency, position.costDate, position.costLabel])
    const previous = positionsByLot.get(key)
    if (!previous || (position.currency === currency && previous.currency !== currency)
        || (previous.currency !== currency && position.currency === position.costCurrency && previous.currency !== previous.costCurrency)) positionsByLot.set(key, position)
  }
  const positions = [...positionsByLot.values()]
  const listedNames = new Set([...cash, ...otherAssets, ...debts].map(account => account.name))
  const remaining = ledger.accounts.filter(account => (account.kind === 'asset' || account.kind === 'liability') && !listedNames.has(account.name))
  return <>
    <section className="account-summary-grid" aria-label="资产总览"><article className="networth-card"><div className="stat-label"><Landmark size={18} />净资产{currency !== 'CNY' && <span className="unit-label">{currency}</span>}</div><Money amount={report.netWorth} className="account-total" symbol />{report.netWorth === null && <p className="account-note">缺少报价，净资产暂不可用</p>}</article><article className="stat-card cash-card"><div className="stat-label"><Wallet size={17} />现金与存款</div><Money amount={report.cash} className="stat-amount" symbol /></article><article className="stat-card debt-card"><div className="stat-label"><CreditCard size={17} />待还款</div><Money amount={report.liabilities} className="stat-amount" symbol /></article></section>
    <div className="accounts-layout">
      <section ref={cashRef} className="panel account-list-panel"><SectionTitle title="现金与存款" subtitle={`${new Set(cash.map(account => account.name)).size} 个账户`} />{cash.length ? <div className="account-list">{cash.map((account, index) => <button className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}><span className={`account-avatar account-color-${index % 4}`}>{/Bank|Savings/.test(account.name) ? <Building2 size={21} strokeWidth={1.6} /> : <Wallet size={21} strokeWidth={1.6} />}</span><span className="account-info"><strong>{account.label}</strong>{account.currency !== 'CNY' && <small>{account.currency}</small>}</span><span className="account-balance"><Money amount={account.balance} currency={account.currency} /></span><ChevronRight size={15} className="account-row-arrow" /></button>)}</div> : <EmptyState title="暂无现金账户" />}</section>
      {otherAssets.length > 0 && <section className="panel account-list-panel"><SectionTitle title="其他资产" /><div className="account-list">{otherAssets.map(account => <button className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}><span className="account-avatar"><Wallet size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{account.label}</strong>{account.currency !== 'CNY' && <small>{account.currency}</small>}</span><span className="account-balance"><Money amount={account.balance} currency={account.currency} /></span><ChevronRight size={15} className="account-row-arrow" /></button>)}</div></section>}
      <section ref={debtRef} className="panel liability-panel"><SectionTitle title="待还款" />{debts.length ? <div className="account-list">{debts.map(account => <button className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}><span className="account-avatar debt-avatar"><CreditCard size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{account.label}</strong><small>{new Decimal(account.balance).gt(0) ? '溢缴款' : '待还款'}</small></span><span className="account-balance"><Money amount={new Decimal(account.balance).abs().toFixed()} currency={account.currency} />{account.currency !== 'CNY' && <small>{account.currency}</small>}</span><ChevronRight size={15} className="account-row-arrow" /></button>)}</div> : <EmptyState title="暂无待还款" />}</section>
      {remaining.length > 0 && <section className="panel account-list-panel"><SectionTitle title="其他账户" /><div className="account-list">{remaining.map(account => {
        const balances = report.accounts.filter(balance => balance.name === account.name)
        return <button className="account-row" key={account.name} onClick={() => onAccount(account.name)}><span className="account-avatar">{account.kind === 'liability' ? <CreditCard size={21} strokeWidth={1.6} /> : <Wallet size={21} strokeWidth={1.6} />}</span><span className="account-info"><strong>{account.label}</strong></span><span className="account-balance">{balances.length ? balances.map(balance => <span key={balance.currency}><Money amount={balance.balance} currency={balance.currency} />{balance.currency !== 'CNY' && ` ${balance.currency}`}</span>) : <><Money amount={null} /><small>暂无记录</small></>}</span><ChevronRight size={15} className="account-row-arrow" /></button>
      })}</div></section>}
    </div>
    <section className="panel investment-panel"><SectionTitle title="投资持仓" />{positions.length ? <div className="position-list">{positions.map((position, index) => <article className="position-row" key={`${position.account}-${index}`}><div className="position-name"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><div><strong>{position.commodity}</strong><small>{position.accountLabel} · {hidden ? '••••' : position.units} 份{position.costDate ? ` · 批次 ${position.costDate}` : ''}{position.costLabel ? ` · ${position.costLabel}` : ''}</small></div></div><div className="position-metrics"><div><span>持仓成本</span><Money amount={position.cost} currency={position.costCurrency ?? position.currency} />{(position.costCurrency ?? position.currency) !== 'CNY' && <> {position.costCurrency ?? position.currency}</>}</div><div><span>市值 · {position.priceDate ? shortDate(position.priceDate) : '缺少报价'}</span><span><Money amount={position.marketValue} currency={position.currency} />{position.currency && position.currency !== 'CNY' && ` ${position.currency}`}</span></div><div><span>未实现盈亏</span><span className={position.unrealizedPnl && new Decimal(position.unrealizedPnl).gte(0) ? 'income-tone' : 'expense-tone'}><Money amount={position.unrealizedPnl} currency={position.currency} signed /></span></div></div></article>)}</div> : <EmptyState title="暂无投资持仓" />}<details className="disclosure"><summary>估值口径</summary><div className="disclosure-content"><p>按账本最新报价估值。</p><p>净资产 = 现金与存款 + 其他资产 + 投资市值 − 待还款 + 溢缴款。</p></div></details></section>
  </>
}
