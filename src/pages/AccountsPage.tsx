import Decimal from 'decimal.js'
import { useEffect, useRef } from 'react'
import { Building2, ChevronRight, CreditCard, Landmark, Wallet } from 'lucide-react'
import { getAccounts, isInvestmentAccount, summarizeInvestments } from '../domain'
import type { Ledger, LedgerAccount } from '../domain/types'
import { EmptyState, Money, SectionTitle } from '../components/ui'
import InvestmentPanel from '../components/InvestmentPanel'
import { accountLabels } from '../lib/accountLabels'

function EmptyAccountRows({ accounts, labels, onAccount }: { accounts: LedgerAccount[]; labels: Map<string, string>; onAccount: (name: string) => void }) {
  return <>{accounts.map(account => <button className="account-row" key={account.name} onClick={() => onAccount(account.name)}><span className="account-avatar">{account.kind === 'liability' ? <CreditCard size={21} strokeWidth={1.6} /> : <Wallet size={21} strokeWidth={1.6} />}</span><span className="account-info"><strong>{labels.get(account.name) ?? account.label}</strong><small>暂无记录</small></span><span className="account-balance">—</span><ChevronRight size={15} className="account-row-arrow" /></button>)}</>
}

export default function AccountsPage({ ledger, currency, onAccount, section }: { ledger: Ledger; currency: string; onAccount: (account: string) => void; section?: 'cash' | 'debt' }) {
  const cashRef = useRef<HTMLElement>(null)
  const debtRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (section) (section === 'cash' ? cashRef : debtRef).current?.scrollIntoView({ block: 'start' })
  }, [section])
  const labels = accountLabels(ledger.accounts)
  const report = getAccounts(ledger, undefined, currency)
  const investments = summarizeInvestments(ledger, report, currency)
  const investmentMonetaryKeys = new Set(investments.monetaryAssets.map(account => `${account.name}\0${account.currency}`))
  const cash = report.accounts.filter(account => account.kind === 'asset' && account.role === 'cash')
  const otherAssets = report.accounts.filter(account => account.kind === 'asset' && account.role === 'other' && !investmentMonetaryKeys.has(`${account.name}\0${account.currency}`))
  const debts = report.accounts.filter(account => account.kind === 'liability' && account.role !== 'investment')
  const listedNames = new Set([...cash, ...otherAssets, ...debts, ...investments.monetaryAssets, ...investments.holdings].map(account => 'name' in account ? account.name : account.account))
  const remaining = ledger.accounts.filter(account => (account.kind === 'asset' || account.kind === 'liability') && !listedNames.has(account.name))
  const emptyCash = remaining.filter(account => account.kind === 'asset' && account.role === 'cash')
  const emptyDebt = remaining.filter(account => account.kind === 'liability')
  const emptyInvestment = remaining.filter(account => account.kind === 'asset' && account.role !== 'cash' && (account.role === 'investment' || isInvestmentAccount(account.name)))
  const emptyOther = remaining.filter(account => account.kind === 'asset' && account.role !== 'cash' && !emptyInvestment.includes(account))
  return <>
    <section className="account-summary-grid" aria-label="资产总览"><article className="networth-card"><div className="stat-label"><Landmark size={18} />净资产{currency !== 'CNY' && <span className="unit-label">{currency}</span>}</div><Money amount={report.netWorth} className="account-total" symbol />{report.netWorth === null && <p className="account-note">缺少报价，净资产暂不可用</p>}</article><article className="stat-card cash-card"><div className="stat-label"><Wallet size={17} />现金与存款</div><Money amount={report.cash} className="stat-amount" symbol /></article><article className="stat-card debt-card"><div className="stat-label"><CreditCard size={17} />待还款</div><Money amount={report.liabilities} className="stat-amount" symbol /></article></section>
    <div className="accounts-layout">
      <section ref={cashRef} className="panel account-list-panel"><SectionTitle title="现金与存款" subtitle={`${new Set([...cash.map(account => account.name), ...emptyCash.map(account => account.name)]).size} 个账户`} />{cash.length || emptyCash.length ? <div className="account-list">{cash.map((account, index) => <button className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}><span className={`account-avatar account-color-${index % 4}`}>{/Bank|Savings/.test(account.name) ? <Building2 size={21} strokeWidth={1.6} /> : <Wallet size={21} strokeWidth={1.6} />}</span><span className="account-info"><strong>{labels.get(account.name) ?? account.label}</strong>{account.currency !== 'CNY' && <small>{account.currency}</small>}</span><span className="account-balance"><Money amount={account.balance} currency={account.currency} /></span><ChevronRight size={15} className="account-row-arrow" /></button>)}<EmptyAccountRows accounts={emptyCash} labels={labels} onAccount={onAccount} /></div> : <EmptyState title="暂无现金账户" />}</section>
      {(otherAssets.length > 0 || emptyOther.length > 0) && <section className="panel account-list-panel"><SectionTitle title="其他资产" /><div className="account-list">{otherAssets.map(account => <button className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}><span className="account-avatar"><Wallet size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{labels.get(account.name) ?? account.label}</strong>{account.currency !== 'CNY' && <small>{account.currency}</small>}</span><span className="account-balance"><Money amount={account.balance} currency={account.currency} /></span><ChevronRight size={15} className="account-row-arrow" /></button>)}<EmptyAccountRows accounts={emptyOther} labels={labels} onAccount={onAccount} /></div></section>}
      <section ref={debtRef} className="panel liability-panel"><SectionTitle title="待还款" />{debts.length || emptyDebt.length ? <div className="account-list">{debts.map(account => <button className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}><span className="account-avatar debt-avatar"><CreditCard size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{labels.get(account.name) ?? account.label}</strong><small>{new Decimal(account.balance).gt(0) ? '溢缴款' : '待还款'}</small></span><span className="account-balance"><Money amount={new Decimal(account.balance).abs().toFixed()} currency={account.currency} />{account.currency !== 'CNY' && <small>{account.currency}</small>}</span><ChevronRight size={15} className="account-row-arrow" /></button>)}<EmptyAccountRows accounts={emptyDebt} labels={labels} onAccount={onAccount} /></div> : <EmptyState title="暂无待还款" />}</section>
    </div>
    <InvestmentPanel summary={investments} ledger={ledger} currency={currency} emptyAccounts={emptyInvestment} onAccount={onAccount} />
  </>
}
