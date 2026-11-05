import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react'
import { useContext, useState } from 'react'
import Decimal from 'decimal.js'
import { getTransactions } from '../domain'
import type { AccountBalance, Ledger, LedgerAccount } from '../domain/types'
import { DisplayContext, EmptyState, Money, SectionTitle } from './ui'
import { formatAmount } from '../lib/format'
import TransactionList from './TransactionList'
import type { summarizeInvestments } from '../domain'
import { accountLabels } from '../lib/accountLabels'
import { investmentLabels } from '../lib/investmentLabels'

type InvestmentSummary = ReturnType<typeof summarizeInvestments>
type Holding = InvestmentSummary['holdings'][number]

function Gain({ amount, currency }: { amount: string | null; currency: string }) {
  const { hidden } = useContext(DisplayContext)
  const tone = hidden || amount === null || new Decimal(amount).isZero() ? '' : new Decimal(amount).gt(0) ? 'income-tone' : 'expense-tone'
  return <span className={tone}><Money amount={amount} currency={currency} signed /></span>
}

function Rate({ value }: { value: string | null }) {
  const { hidden } = useContext(DisplayContext)
  return <span className="holding-rate">{hidden ? '••••' : value === null ? '—' : `${new Decimal(value).gt(0) ? '+' : ''}${formatAmount(value)}%`}</span>
}

function MonetaryInvestment({ account, ledger, label }: { account: AccountBalance; ledger: Ledger; label: string }) {
  const [open, setOpen] = useState(false)
  return <details className="investment-item" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="investment-item-summary"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="investment-item-name"><strong>{label}</strong><small>{new Decimal(account.balance).isZero() ? '余额为零 · 查看历史交易' : '账面余额 · 未记录份额'} · {account.currency}</small></span><span className="investment-item-value"><Money amount={account.balance} currency={account.currency} /></span><ChevronDown size={16} className="investment-chevron" /></summary>
    {open && <div className="investment-item-detail"><TransactionList transactions={getTransactions(ledger, { account: account.name }).filter(transaction => transaction.postings.some(posting => posting.account === account.name && posting.currency === account.currency))} /></div>}
  </details>
}

function HoldingItem({ holding, name, accountLabel, onAccount }: { holding: Holding; name: string; accountLabel: string; onAccount: (account: string) => void }) {
  const { hidden } = useContext(DisplayContext)
  const [allLots, setAllLots] = useState(false)
  const quote = holding.lots[0]
  const lots = allLots ? holding.lots : holding.lots.slice(0, 5)
  const shares = (value: string) => hidden ? '••••' : formatAmount(value, 4)
  return <details className="investment-item holding-item">
    <summary className="investment-item-summary">
      <span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span>
      <span className="investment-item-name"><strong>{name}</strong><small>{holding.commodity} · {holding.currency || '币种待确认'}</small></span>
      <span className="investment-item-value"><small>{holding.marketValue === null ? '缺少报价' : '持仓市值'}</small><Money amount={holding.marketValue} currency={holding.currency} /></span>
      <ChevronDown size={16} className="investment-chevron" />
      <span className="holding-summary-metrics">
        <span className="holding-summary-metric"><span>持有份额</span><span className="money">{shares(holding.units)} 份</span></span>
        <span className="holding-summary-metric"><span>总成本</span><span className="holding-cost-values">{holding.costs ? holding.costs.map(cost => <span key={cost.currency}><Money amount={cost.amount} currency={cost.currency} />{cost.currency !== holding.currency && ` ${cost.currency}`}</span>) : <Money amount={null} />}</span></span>
        <span className="holding-summary-metric"><span>持仓盈亏</span><span className="holding-gain"><Gain amount={holding.unrealizedPnl} currency={holding.currency} /><Rate value={holding.returnRate} /></span></span>
      </span>
    </summary>
    <div className="investment-item-detail">
      <div className="holding-quote-grid">
        <div><span>最新账本净值</span><strong><Money amount={quote.status === 'ok' ? quote.price : null} currency={holding.currency} decimals={4} /> {holding.currency}</strong><small>{quote.priceDate ? `报价日期 ${quote.priceDate}` : '尚无可用报价'}</small></div>
        <div><span>平均持仓单价</span><strong><Money amount={holding.averageCost} decimals={4} /> {holding.costs?.length === 1 ? holding.costs[0].currency : ''}</strong><small>按剩余份额加权</small></div>
      </div>
      {holding.unrealizedPnl === null && <p className="holding-note">{holding.marketValue === null ? '缺少可用报价，暂无法计算市值和盈亏。' : '成本缺失、币种不同或含负份额，暂无法计算持仓盈亏。'}</p>}
      <div className="holding-lots-heading"><h3>买入批次 <span>{holding.lots.length}</span></h3><span>剩余持仓 · 最近买入在前</span></div>
      <div className="holding-lots">{lots.map((position, index) => <article className="holding-lot" key={index}>
        <div className="holding-lot-date"><strong>{position.costDate ?? '日期未记录'}</strong>{position.costLabel && <small>{position.costLabel}</small>}<span className="money">{shares(position.units)} 份</span></div>
        <div><span>买入单价</span><span><Money amount={position.unitCost} currency={position.costCurrency ?? holding.currency} decimals={4} />{position.costCurrency !== holding.currency && ` ${position.costCurrency ?? ''}`}</span></div>
        <div><span>剩余成本</span><span><Money amount={position.cost} currency={position.costCurrency ?? holding.currency} />{position.costCurrency !== holding.currency && ` ${position.costCurrency ?? ''}`}</span></div>
        <div><span>持仓盈亏</span><Gain amount={position.unrealizedPnl} currency={holding.currency} /></div>
      </article>)}</div>
      {holding.lots.length > 5 && <button className="text-action holding-more" onClick={() => setAllLots(!allLots)} aria-expanded={allLots}>{allLots ? '收起较早批次' : `查看全部 ${holding.lots.length} 个批次`}<ChevronDown size={15} /></button>}
      <div className="holding-account-link"><span>{accountLabel}</span><button className="text-action investment-transactions" onClick={() => onAccount(holding.account)}>查看账户交易 <ChevronRight size={15} /></button></div>
    </div>
  </details>
}

export default function InvestmentPanel({ summary, ledger, emptyAccounts, onAccount }: { summary: InvestmentSummary; ledger: Ledger; currency: string; emptyAccounts: LedgerAccount[]; onAccount: (account: string) => void }) {
  const labels = accountLabels(ledger.accounts)
  const names = investmentLabels(ledger)
  const activeBalances = summary.monetaryAssets.filter(account => !new Decimal(account.balance).isZero())
  const zeroBalances = summary.monetaryAssets.filter(account => new Decimal(account.balance).isZero())
  return <section className="panel investment-panel"><SectionTitle title="投资持仓" subtitle="全部账本持仓 · 按账本最新报价估值" />
    {summary.totals.map(total => <div className="investment-overview" key={total.currency}>
      <div className="investment-overview-value"><span>持仓总市值 · {total.currency || '币种待确认'}</span><Money amount={total.marketValue} currency={total.currency} /><small>{total.count} 项持仓{total.marketValue === null ? ' · 报价不完整' : ''}</small></div>
      <div><span>持仓总成本</span><Money amount={total.cost} currency={total.currency} /></div>
      <div><span>持仓总盈亏</span><Gain amount={total.unrealizedPnl} currency={total.currency} /><Rate value={total.returnRate} /></div>
    </div>)}
    {summary.holdings.length > 0 && <p className="investment-caption">盈亏与收益率仅计剩余持仓；不含已卖出收益、分红及未计入成本的费用。金额单位为各项标注币种。</p>}
    <div className="position-list">
      {summary.holdings.map(holding => <HoldingItem key={JSON.stringify([holding.account, holding.commodity, holding.currency])} holding={holding} name={names.get(holding.account) ?? holding.commodity} accountLabel={labels.get(holding.account) ?? holding.account} onAccount={onAccount} />)}
      {activeBalances.length > 0 && <div className="investment-balances"><h3>其他投资余额</h3><p className="holding-note">仅记录金额的账户，单独展示账面余额。</p>{activeBalances.map(account => <MonetaryInvestment key={`${account.name}:${account.currency}`} account={account} ledger={ledger} label={names.get(account.name) ?? labels.get(account.name) ?? account.name} />)}</div>}
      {(zeroBalances.length > 0 || emptyAccounts.length > 0) && <details className="investment-history"><summary>零余额与未持仓账户 <span>{zeroBalances.length + emptyAccounts.length}</span><ChevronDown size={15} /></summary>
        {zeroBalances.map(account => <MonetaryInvestment key={`${account.name}:${account.currency}`} account={account} ledger={ledger} label={names.get(account.name) ?? labels.get(account.name) ?? account.name} />)}
        {emptyAccounts.map(account => <button className="account-row" key={account.name} onClick={() => onAccount(account.name)}><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{names.get(account.name) ?? labels.get(account.name) ?? account.name}</strong><small>暂无持仓</small></span><span className="account-balance">—</span><ChevronRight size={15} className="account-row-arrow" /></button>)}
      </details>}
    </div>
    {!summary.holdings.length && !activeBalances.length && <EmptyState title="暂无投资持仓" />}
  </section>
}
