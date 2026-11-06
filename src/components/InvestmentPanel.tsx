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

const staleQuoteDays = 7
const dayMs = 86_400_000

function quoteDate(holding: Holding) {
  return holding.marketValue === null ? null : holding.lots[0].priceDate
}

function quoteIsStale(date: string, today: number) {
  return today - Date.parse(date) >= staleQuoteDays * dayMs
}

function QuoteDates({ dates, today }: { dates: string[]; today: number }) {
  if (!dates.length) return null
  const ordered = [...dates].sort()
  const oldest = ordered[0]
  const latest = ordered[ordered.length - 1]
  const stale = dates.filter(date => quoteIsStale(date, today)).length
  return <small className="investment-quote-date">
    报价 <time dateTime={oldest}>{oldest}</time>{latest !== oldest && <> 至 <time dateTime={latest}>{latest}</time></>}
    {stale > 0 && <span className="investment-quote-stale"> · {dates.length === 1 ? '报价较旧' : `${stale} 项报价较旧`}</span>}
  </small>
}

function Gain({ amount, currency }: { amount: string | null; currency: string }) {
  const { hidden } = useContext(DisplayContext)
  const rounded = amount === null ? null : new Decimal(amount).toDecimalPlaces(2)
  const tone = hidden || rounded === null || rounded.isZero() ? '' : rounded.gt(0) ? 'income-tone' : 'expense-tone'
  return <span className={tone}><Money amount={rounded?.isZero() ? '0' : rounded?.toFixed() ?? null} currency={currency} signed /></span>
}

function Rate({ value }: { value: string | null }) {
  const { hidden } = useContext(DisplayContext)
  const rounded = value === null ? null : new Decimal(value).toDecimalPlaces(2)
  return <span className="holding-rate">{hidden ? '••••' : rounded === null ? '—' : `${rounded.gt(0) ? '+' : ''}${formatAmount(rounded.isZero() ? '0' : rounded.toFixed())}%`}</span>
}

function MonetaryInvestment({ account, ledger, label }: { account: AccountBalance; ledger: Ledger; label: string }) {
  const [open, setOpen] = useState(false)
  return <details className="investment-item" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="investment-item-summary"><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="investment-item-name"><strong>{label}</strong><small>{account.currency}</small></span><span className="investment-item-value"><Money amount={account.balance} currency={account.currency} /></span><ChevronDown size={16} className="investment-chevron" /></summary>
    {open && <div className="investment-item-detail"><TransactionList transactions={getTransactions(ledger, { account: account.name }).filter(transaction => transaction.postings.some(posting => posting.account === account.name && posting.currency === account.currency))} /></div>}
  </details>
}

function HoldingItem({ holding, name, accountLabel, onAccount, today }: { holding: Holding; name: string; accountLabel: string; onAccount: (account: string) => void; today: number }) {
  const { hidden } = useContext(DisplayContext)
  const [allLots, setAllLots] = useState(false)
  const quote = holding.lots[0]
  const date = quoteDate(holding)
  const lots = allLots ? holding.lots : holding.lots.slice(0, 5)
  const shares = (value: string) => hidden ? '••••' : formatAmount(value, 4)
  return <details className="investment-item holding-item">
    <summary className="investment-item-summary">
      <span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span>
      <span className="investment-item-name"><strong>{name}</strong><small>{holding.commodity} · {holding.currency || '币种待确认'}</small>{date && <QuoteDates dates={[date]} today={today} />}</span>
      <span className="investment-item-value"><small>{holding.marketValue === null ? '缺少报价' : '持仓市值'}</small><Money amount={holding.marketValue} currency={holding.currency} /></span>
      <ChevronDown size={16} className="investment-chevron" />
      <span className="holding-summary-metrics">
        <span className="holding-summary-metric"><span>持有份额</span><span className="money">{shares(holding.units)} 份</span></span>
        <span className="holding-summary-metric"><span>剩余成本</span><span className="holding-cost-values">{holding.costs ? holding.costs.map(cost => <span key={cost.currency}><Money amount={cost.amount} currency={cost.currency} />{cost.currency !== holding.currency && ` ${cost.currency}`}</span>) : <Money amount={null} />}</span></span>
        <span className="holding-summary-metric"><span>累计盈亏</span><span className="holding-gain"><Gain amount={holding.cumulativePnl} currency={holding.currency} /><Rate value={holding.cumulativeReturnRate} /></span></span>
      </span>
      <span className="holding-profit-breakdown"><span>已实现盈亏 <Gain amount={holding.realizedPnl} currency={holding.currency} /></span><span>持仓浮动盈亏 <Gain amount={holding.unrealizedPnl} currency={holding.currency} /></span></span>
    </summary>
    <div className="investment-item-detail">
      <div className="holding-cash-grid">
        <div><span>累计投入</span><Money amount={holding.invested} currency={holding.currency} /></div>
        <div><span>卖出净收回</span><Money amount={holding.withdrawn} currency={holding.currency} /></div>
        <div><span>净投入</span><Money amount={holding.netInvested} currency={holding.currency} /></div>
      </div>
      <div className="holding-quote-grid">
        <div><span>最新账本净值</span><strong><Money amount={quote.status === 'ok' ? quote.price : null} currency={holding.currency} decimals={4} /> {holding.currency}</strong></div>
        <div><span>平均持仓单价</span><strong><Money amount={holding.averageCost} decimals={4} /> {holding.costs?.length === 1 ? holding.costs[0].currency : ''}</strong></div>
        <div><span>回本参考净值</span><strong><Money amount={holding.breakEvenPrice} currency={holding.currency} decimals={4} /> {holding.currency}</strong></div>
      </div>
      <div className="holding-lots-heading"><h3>买入批次 <span>{holding.lots.length}</span></h3></div>
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
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const activeBalances = summary.monetaryAssets.filter(account => !new Decimal(account.balance).isZero())
  const zeroBalances = summary.monetaryAssets.filter(account => new Decimal(account.balance).isZero())
  return <section className="panel investment-panel"><SectionTitle title="投资持仓" />
    {summary.totals.map(total => <div className="investment-overview" key={total.currency}>
      <div className="investment-overview-value"><span>持仓总市值 · {total.currency || '币种待确认'}</span><Money amount={total.marketValue} currency={total.currency} /><small>{total.count} 项持仓{total.marketValue === null ? ' · 报价不完整' : ''}</small><QuoteDates dates={summary.holdings.filter(holding => holding.currency === total.currency).flatMap(holding => quoteDate(holding) ?? [])} today={today} /></div>
      <div><span>在持基金累计投入</span><Money amount={total.invested} currency={total.currency} /></div>
      <div><span>在持基金累计盈亏</span><Gain amount={total.cumulativePnl} currency={total.currency} /><Rate value={total.cumulativeReturnRate} /></div>
    </div>)}
    <div className="position-list">
      {summary.holdings.map(holding => <HoldingItem key={JSON.stringify([holding.account, holding.commodity, holding.currency])} holding={holding} name={names.get(holding.account) ?? holding.commodity} accountLabel={labels.get(holding.account) ?? holding.account} onAccount={onAccount} today={today} />)}
      {activeBalances.length > 0 && <div className="investment-balances"><h3>其他投资余额</h3>{activeBalances.map(account => <MonetaryInvestment key={`${account.name}:${account.currency}`} account={account} ledger={ledger} label={names.get(account.name) ?? labels.get(account.name) ?? account.name} />)}</div>}
      {(zeroBalances.length > 0 || emptyAccounts.length > 0) && <details className="investment-history"><summary>零余额与未持仓账户 <span>{zeroBalances.length + emptyAccounts.length}</span><ChevronDown size={15} /></summary>
        {zeroBalances.map(account => <MonetaryInvestment key={`${account.name}:${account.currency}`} account={account} ledger={ledger} label={names.get(account.name) ?? labels.get(account.name) ?? account.name} />)}
        {emptyAccounts.map(account => <button className="account-row" key={account.name} onClick={() => onAccount(account.name)}><span className="account-avatar investment-avatar"><TrendingUp size={21} strokeWidth={1.6} /></span><span className="account-info"><strong>{names.get(account.name) ?? labels.get(account.name) ?? account.name}</strong><small>暂无持仓</small></span><span className="account-balance">—</span><ChevronRight size={15} className="account-row-arrow" /></button>)}
      </details>}
    </div>
    {!summary.holdings.length && !activeBalances.length && <EmptyState title="暂无投资持仓" />}
  </section>
}
