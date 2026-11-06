import Decimal from 'decimal.js'
import { useEffect, useMemo, useRef } from 'react'
import { Building2, ChevronRight, CreditCard, Landmark, Wallet } from 'lucide-react'
import { getAccounts, isInvestmentAccount, summarizeInvestments } from '../domain'
import type { AccountBalance, Ledger, LedgerAccount } from '../domain/types'
import { EmptyState, Money } from '../components/ui'
import InvestmentPanel from '../components/InvestmentPanel'
import { accountLabels } from '../lib/accountLabels'

function AccountRows({ accounts, emptyAccounts, labels, onAccount, type }: {
  accounts: AccountBalance[]
  emptyAccounts: LedgerAccount[]
  labels: Map<string, string>
  onAccount: (name: string) => void
  type: 'cash' | 'debt' | 'other'
}) {
  return <div className="account-list">
    {accounts.map((account, index) => {
      const debt = type === 'debt' ? new Decimal(account.balance) : null
      const Icon = debt ? CreditCard : type === 'cash' && /Bank|Savings/.test(account.name) ? Building2 : Wallet
      const avatar = debt ? 'debt-avatar' : type === 'cash' ? `account-color-${index % 4}` : ''
      const foreignCurrency = account.currency !== 'CNY' ? account.currency : null
      return <button type="button" className="account-row" key={`${account.name}:${account.currency}`} onClick={() => onAccount(account.name)}>
        <span className={`account-avatar ${avatar}`}><Icon size={21} strokeWidth={1.6} /></span>
        <span className="account-info">
          <strong>{labels.get(account.name) ?? account.label}</strong>
          {debt ? <small>{debt.gt(0) ? '溢缴款' : '待还款'}</small> : foreignCurrency && <small>{foreignCurrency}</small>}
        </span>
        <span className="account-balance">
          <Money amount={debt ? debt.abs().toFixed() : account.balance} currency={account.currency} />
          {debt && foreignCurrency && <small>{foreignCurrency}</small>}
        </span>
        <ChevronRight size={15} className="account-row-arrow" />
      </button>
    })}
    {emptyAccounts.map(account => <button type="button" className="account-row" key={account.name} onClick={() => onAccount(account.name)}>
      <span className="account-avatar">{account.kind === 'liability' ? <CreditCard size={21} strokeWidth={1.6} /> : <Wallet size={21} strokeWidth={1.6} />}</span>
      <span className="account-info"><strong>{labels.get(account.name) ?? account.label}</strong><small>暂无记录</small></span>
      <span className="account-balance">—</span><ChevronRight size={15} className="account-row-arrow" />
    </button>)}
  </div>
}

export default function AccountsPage({ ledger, currency, onAccount, section }: { ledger: Ledger; currency: string; onAccount: (account: string) => void; section?: 'cash' | 'debt' }) {
  const cashRef = useRef<HTMLElement>(null)
  const debtRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (section) (section === 'cash' ? cashRef : debtRef).current?.scrollIntoView({ block: 'start' })
  }, [section])
  const labels = accountLabels(ledger.accounts)
  const report = useMemo(() => getAccounts(ledger, undefined, currency), [ledger, currency])
  const investments = useMemo(() => summarizeInvestments(ledger, report, currency), [ledger, report, currency])
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
  const cashCount = new Set([...cash, ...emptyCash].map(account => account.name)).size

  return <>
    <section className="panel account-section total-assets-panel" aria-labelledby="total-assets-title">
      <div className="section-heading"><h2 id="total-assets-title">总资产</h2><Landmark size={20} className="account-section-icon" aria-hidden="true" /></div>
      <Money amount={report.netWorth} currency={currency} className="account-total" symbol />
      {report.netWorth === null && <p className="account-note">缺少报价，总资产暂不可用</p>}
      {(otherAssets.length > 0 || emptyOther.length > 0) && <section className="account-other-assets">
        <h3 className="account-detail-title">其他资产</h3>
        <AccountRows accounts={otherAssets} emptyAccounts={emptyOther} labels={labels} onAccount={onAccount} type="other" />
      </section>}
    </section>

    <section className="panel account-section available-funds-panel" aria-labelledby="available-funds-title">
      <div className="section-heading"><h2 id="available-funds-title">可用资金</h2><Wallet size={20} className="account-section-icon" aria-hidden="true" /></div>
      <div className="available-funds-overview">
        <Money amount={report.availableFunds} currency={currency} className="account-total" symbol />
        <dl className="available-funds-breakdown">
          <div><dt>现金与存款</dt><dd><Money amount={report.cash} currency={currency} symbol /></dd></div>
          <div><dt>待还款</dt><dd><Money amount={report.liabilities} currency={currency} symbol /></dd></div>
        </dl>
      </div>
      <div className="available-account-lists">
        <section ref={cashRef} className="account-list-panel">
          <div className="account-detail-heading"><h3 className="account-detail-title">现金与存款</h3><small>{cashCount} 个账户</small></div>
          {cashCount > 0
            ? <AccountRows accounts={cash} emptyAccounts={emptyCash} labels={labels} onAccount={onAccount} type="cash" />
            : <EmptyState title="暂无现金账户" />}
        </section>
        <section ref={debtRef} className="liability-panel">
          <div className="account-detail-heading"><h3 className="account-detail-title">待还款</h3></div>
          {debts.length || emptyDebt.length
            ? <AccountRows accounts={debts} emptyAccounts={emptyDebt} labels={labels} onAccount={onAccount} type="debt" />
            : <EmptyState title="暂无待还款" />}
        </section>
      </div>
    </section>

    <InvestmentPanel summary={investments} ledger={ledger} currency={currency} emptyAccounts={emptyInvestment} onAccount={onAccount} />
  </>
}
