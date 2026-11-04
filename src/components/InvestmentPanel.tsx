import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react'
import { useContext, useState } from 'react'
import Decimal from 'decimal.js'
import { getTransactions } from '../domain'
import type { AccountBalance, Ledger, LedgerAccount } from '../domain/types'
import { DisplayContext, EmptyState, Money, SectionTitle } from './ui'
import { shortDate } from '../lib/format'
import TransactionList from './TransactionList'
import type { summarizeInvestments } from '../domain'
import { accountLabels } from '../lib/accountLabels'

type InvestmentSummary = ReturnType<typeof summarizeInvestments>

function MonetaryInvestment({ account, ledger, currency, label }: { account: AccountBalance; ledger: Ledger; currency: string; label: string }) {
  const [open, setOpen] = useState(false)
  return <details className="investment-item" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="investment-item-summary"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="investment-item-name"><strong>{label}</strong><small>账面余额{account.currency !== currency ? ` · ${account.currency}` : ''}</small></span><span className="investment-item-value"><Money amount={account.balance} currency={account.currency} />{account.currency !== currency && <small>{account.currency}</small>}</span><ChevronDown size={16} className="investment-chevron" /><span className="holding-summary-metrics"><span className="holding-summary-metric"><span>总成本</span><Money amount={null} /></span><span className="holding-summary-metric"><span>持仓盈亏</span><Money amount={null} /></span></span></summary>
    {open && <div className="investment-item-detail"><TransactionList transactions={getTransactions(ledger, { account: account.name }).filter(transaction => transaction.postings.some(posting => posting.account === account.name && posting.currency === account.currency))} /></div>}
  </details>
}

export default function InvestmentPanel({ summary, ledger, currency, emptyAccounts, onAccount }: { summary: InvestmentSummary; ledger: Ledger; currency: string; emptyAccounts: LedgerAccount[]; onAccount: (account: string) => void }) {
  const { hidden } = useContext(DisplayContext)
  const labels = accountLabels(ledger.accounts)
  return <section className="panel investment-panel"><SectionTitle title="投资持仓" />
    {summary.monetaryAssets.length || summary.holdings.length || emptyAccounts.length ? <div className="position-list">
      {summary.monetaryAssets.map(account => <MonetaryInvestment key={`${account.name}:${account.currency}`} account={account} ledger={ledger} currency={currency} label={labels.get(account.name) ?? account.name} />)}
      {summary.holdings.map(holding => <details className="investment-item" key={JSON.stringify([holding.account, holding.commodity, holding.currency])}>
        <summary className="investment-item-summary"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="investment-item-name"><strong>{holding.commodity}</strong><small>{labels.get(holding.account) ?? holding.account} · {holding.marketValue === null ? '缺少报价' : '市值'}</small></span><span className="investment-item-value"><Money amount={holding.marketValue} currency={holding.currency} />{holding.currency && holding.currency !== currency && <small>{holding.currency}</small>}</span><ChevronDown size={16} className="investment-chevron" />
          <span className="holding-summary-metrics"><span className="holding-summary-metric"><span>总成本</span><span className="holding-cost-values">{holding.costs ? holding.costs.map(cost => <span key={cost.currency}><Money amount={cost.amount} currency={cost.currency} />{(holding.costs!.length > 1 || cost.currency !== holding.currency) && ` ${cost.currency}`}</span>) : <Money amount={null} />}</span></span><span className="holding-summary-metric"><span>持仓盈亏</span><span className={holding.unrealizedPnl === null ? '' : new Decimal(holding.unrealizedPnl).gte(0) ? 'income-tone' : 'expense-tone'}><Money amount={holding.unrealizedPnl} currency={holding.currency} signed /></span></span></span>
        </summary>
        <div className="investment-item-detail">{holding.lots.map((position, index) => <article className="position-row" key={index}><div className="position-name"><span><strong>{hidden ? '••••' : position.units} 份</strong><small>{position.costDate ? `批次 ${position.costDate}` : '未记录批次日期'}{position.costLabel ? ` · ${position.costLabel}` : ''}</small></span></div><div className="position-metrics"><div><span>买入单价</span><span><Money amount={position.unitCost} currency={position.costCurrency ?? position.currency} decimals={position.unitCost === null ? 2 : Math.max(2, new Decimal(position.unitCost).decimalPlaces())} />{position.costCurrency && position.costCurrency !== 'CNY' && ` ${position.costCurrency}`}</span></div><div><span>持仓成本</span><span><Money amount={position.cost} currency={position.costCurrency ?? position.currency} />{position.costCurrency && position.costCurrency !== 'CNY' && ` ${position.costCurrency}`}</span></div><div><span>市值 · {position.priceDate ? shortDate(position.priceDate) : '缺少报价'}</span><span><Money amount={position.marketValue} currency={position.currency} />{position.currency && position.currency !== 'CNY' && ` ${position.currency}`}</span></div><div><span>未实现盈亏</span><span className={position.unrealizedPnl === null ? '' : new Decimal(position.unrealizedPnl).gte(0) ? 'income-tone' : 'expense-tone'}><Money amount={position.unrealizedPnl} currency={position.currency} signed /></span></div></div></article>)}<button className="text-action investment-transactions" onClick={() => onAccount(holding.account)}>查看账户交易 <ChevronRight size={15} /></button></div>
      </details>)}
      {emptyAccounts.map(account => <button className="account-row" key={account.name} onClick={() => onAccount(account.name)}><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{labels.get(account.name) ?? account.name}</strong><small>暂无记录</small></span><span className="account-balance">—</span><ChevronRight size={15} className="account-row-arrow" /></button>)}
    </div> : <EmptyState title="暂无投资持仓" />}
  </section>
}
