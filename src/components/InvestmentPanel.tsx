import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react'
import { useContext, useState } from 'react'
import Decimal from 'decimal.js'
import { getTransactions } from '../domain'
import type { AccountBalance, Ledger, LedgerAccount } from '../domain/types'
import { DisplayContext, EmptyState, Money, SectionTitle } from './ui'
import { shortDate } from '../lib/format'
import TransactionList from './TransactionList'
import type { summarizeInvestments } from '../domain'

type InvestmentSummary = ReturnType<typeof summarizeInvestments>

function MonetaryInvestment({ account, ledger, currency }: { account: AccountBalance; ledger: Ledger; currency: string }) {
  const [open, setOpen] = useState(false)
  return <details className="investment-item" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="investment-item-summary"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="investment-item-name"><strong>{account.label}</strong><small>账面余额{account.currency !== currency ? ` · ${account.currency}` : ''}</small></span><span className="investment-item-value"><Money amount={account.balance} currency={account.currency} />{account.currency !== currency && <small>{account.currency}</small>}</span><ChevronDown size={16} className="investment-chevron" /></summary>
    {open && <div className="investment-item-detail"><TransactionList transactions={getTransactions(ledger, { account: account.name }).filter(transaction => transaction.postings.some(posting => posting.account === account.name && posting.currency === account.currency))} /></div>}
  </details>
}

export default function InvestmentPanel({ summary, ledger, currency, emptyAccounts, onAccount }: { summary: InvestmentSummary; ledger: Ledger; currency: string; emptyAccounts: LedgerAccount[]; onAccount: (account: string) => void }) {
  const { hidden } = useContext(DisplayContext)
  return <section className="panel investment-panel"><SectionTitle title="投资持仓" />
    {summary.monetaryAssets.length || summary.holdings.length || emptyAccounts.length ? <div className="position-list">
      {summary.monetaryAssets.map(account => <MonetaryInvestment key={`${account.name}:${account.currency}`} account={account} ledger={ledger} currency={currency} />)}
      {summary.holdings.map(holding => <details className="investment-item" key={JSON.stringify([holding.account, holding.commodity, holding.currency])}>
        <summary className="investment-item-summary"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="investment-item-name"><strong>{holding.commodity}</strong><small>{holding.accountLabel} · {holding.marketValue === null ? '缺少报价' : '市值'}</small></span><span className="investment-item-value"><Money amount={holding.marketValue} currency={holding.currency} />{holding.currency && holding.currency !== currency && <small>{holding.currency}</small>}</span><ChevronDown size={16} className="investment-chevron" /></summary>
        <div className="investment-item-detail">{holding.lots.map((position, index) => <article className="position-row" key={index}><div className="position-name"><span><strong>{hidden ? '••••' : position.units} 份</strong><small>{position.costDate ? `批次 ${position.costDate}` : '未记录批次日期'}{position.costLabel ? ` · ${position.costLabel}` : ''}</small></span></div><div className="position-metrics"><div><span>持仓成本</span><Money amount={position.cost} currency={position.costCurrency ?? position.currency} />{(position.costCurrency ?? position.currency) !== 'CNY' && <> {position.costCurrency ?? position.currency}</>}</div><div><span>市值 · {position.priceDate ? shortDate(position.priceDate) : '缺少报价'}</span><span><Money amount={position.marketValue} currency={position.currency} />{position.currency && position.currency !== 'CNY' && ` ${position.currency}`}</span></div><div><span>未实现盈亏</span><span className={position.unrealizedPnl && new Decimal(position.unrealizedPnl).gte(0) ? 'income-tone' : 'expense-tone'}><Money amount={position.unrealizedPnl} currency={position.currency} signed /></span></div></div></article>)}<button className="text-action investment-transactions" onClick={() => onAccount(holding.account)}>查看账户交易 <ChevronRight size={15} /></button></div>
      </details>)}
      {emptyAccounts.map(account => <button className="account-row" key={account.name} onClick={() => onAccount(account.name)}><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{account.label}</strong><small>暂无记录</small></span><span className="account-balance">—</span><ChevronRight size={15} className="account-row-arrow" /></button>)}
    </div> : <EmptyState title="暂无投资持仓" />}
    <details className="disclosure"><summary>估值口径</summary><div className="disclosure-content"><p>持仓按账本最新报价估值，人民币记账的投资按账面余额展示。</p><p>净资产 = 现金与存款 + 其他资产 + 投资市值 − 待还款 + 溢缴款。</p></div></details>
  </section>
}
