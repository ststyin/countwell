import { useContext } from 'react'
import { ArrowRight, ChevronDown, CircleAlert } from 'lucide-react'
import type { Activity, ActivityAmount } from '../domain/types'
import { CategoryIcon, DisplayContext, EmptyState, Money } from './ui'
import { formatAmount, shortDate } from '../lib/format'

export const kindLabels = { income: '收入', expense: '支出', refund: '退款', transfer: '转账', investment: '投资' }

export default function TransactionList({ transactions }: { transactions: Activity[] }) {
  const { hidden } = useContext(DisplayContext)
  const rawAmount = (amount: string) => <span className="money">{hidden ? '••••' : amount}</span>
  if (!transactions.length) return <EmptyState title="暂无交易" description="" />
  return <div className="transaction-list">{transactions.map(tx => {
    const settlement = tx.investmentSettlement
    const cashFlows = settlement?.cashFlows ?? []
    const matchingCash = cashFlows.filter(flow => flow.currency === tx.currency)
    const primaryCash = !tx.amountUnavailable && matchingCash.length === 1 ? matchingCash[0] : undefined
    const direction = primaryCash?.direction ?? tx.direction
    const displayKind = settlement ? 'investment' : tx.kind
    const sign = tx.amountUnavailable ? '' : direction === 'out' ? '−' : direction === 'in' ? '+' : ''
    const tradeLabel = settlement?.action === 'sell' ? '投资卖出' : settlement?.action === 'buy' ? '投资买入' : '持仓变动'
    const label = settlement ? `${tradeLabel}${primaryCash ? ` · ${primaryCash.accountLabel}${primaryCash.direction === 'in' ? '到账' : '付款'}` : ''}` : tx.kind === 'refund' ? '冲减支出' : tx.kind === 'transfer' ? '账户转账' : tx.category
    const primaryIndex = tx.amounts?.findIndex(amount => amount.amount === tx.amount && amount.currency === tx.currency && amount.direction === tx.direction && amount.kind === tx.kind && amount.basis === tx.amountBasis) ?? -1
    const otherAmounts = tx.amounts?.filter((_, index) => primaryCash || index !== primaryIndex) ?? []
    const amountLabel = (amount: ActivityAmount) => amount.kind === 'investment' && amount.direction !== 'internal'
      ? amount.direction === 'out' ? '已实现亏损' : '已实现盈利'
      : settlement && amount.kind === 'investment' && amount.basis === 'weight'
      ? settlement.action === 'sell' ? '卖出成本' : settlement.action === 'buy' ? '买入成本' : '持仓成本'
      : kindLabels[amount.kind]
    const usesWeight = tx.amountBasis === 'weight' || otherAmounts.some(amount => amount.basis === 'weight')
    return <details className={`transaction-row transaction-${displayKind} direction-${direction}`} key={`${tx.id}:${tx.currency}`}>
      <summary>
        <span className={`transaction-icon ${displayKind}-icon`}><CategoryIcon name={settlement ? tradeLabel : tx.category} kind={displayKind} size={19} /></span>
        <span className="transaction-info"><span className="transaction-title">{tx.narration.trim() || '无描述交易'}<span className="transaction-kind">{kindLabels[displayKind]}</span>{tx.flag === '!' && <CircleAlert size={13} className="pending-indicator" aria-label="待核对" />}</span><span className="transaction-subtitle">{shortDate(tx.date)}<span className="mini-dot" />{label}{!primaryCash && tx.amountBasis === 'weight' ? ' · 记账权重' : ''}</span></span>
        <span className={`transaction-amount ${direction === 'in' ? 'income-tone' : direction === 'out' ? 'expense-tone' : ''}`}>
          {!hidden && sign}<Money amount={tx.amountUnavailable ? null : primaryCash?.amount ?? tx.amount} currency={tx.currency} />
          {tx.currency !== 'CNY' && <small>{tx.currency}</small>}{tx.amountUnavailable && <small>金额待确认</small>}
          {settlement && !primaryCash && primaryIndex >= 0 && <small>{amountLabel(tx.amounts![primaryIndex])}</small>}
          {cashFlows.filter(flow => flow !== primaryCash).map(flow => <small key={`${flow.account}:${flow.currency}`}>{flow.accountLabel}{flow.direction === 'in' ? '到账' : '付款'} {hidden ? '••••' : `${flow.direction === 'in' ? '+' : '−'}${formatAmount(flow.amount)}`}{flow.currency !== 'CNY' && ` ${flow.currency}`}</small>)}
          {otherAmounts.map((amount, index) => <small key={index}>{amountLabel(amount)} {hidden ? '••••' : `${amount.direction === 'in' ? '+' : amount.direction === 'out' ? '−' : ''}${formatAmount(amount.amount)}`}{amount.currency !== 'CNY' && ` ${amount.currency}`}{amount.basis === 'weight' && !settlement ? ' · 权重' : ''}</small>)}
        </span>
        <ChevronDown size={15} className="transaction-chevron" />
      </summary>
      <div className="transaction-details">
        <div className="transaction-detail-header"><span>{tx.payee.trim() || '未填写'}</span><span>{tx.flag === '!' ? '待核对' : tx.flag === '*' ? '已确认' : `交易标记：${tx.flag}`}</span></div>
        {tx.kind === 'transfer' && tx.fromAccount && <p className="transfer-description">{tx.fromAccount}<ArrowRight size={13} />{tx.toAccount}</p>}
        <div className="posting-header"><span>复式分录</span></div>
        <div className="posting-list">{tx.postings.map((posting, index) => <div className="posting-row" key={index}>
          <span className="posting-account"><code>{posting.account}</code>
            {posting.flag && <small className="posting-cost">分录标记：{posting.flag}</small>}
            {posting.cost && <small className="posting-cost">每份成本 {rawAmount(posting.cost.amount)} {posting.cost.currency}{posting.cost.date ? ` · ${posting.cost.date}` : ''}{posting.cost.label ? ` · ${posting.cost.label}` : ''}</small>}
            {posting.price && <small className="posting-cost">交易单价 {rawAmount(posting.price.amount)} {posting.price.currency}</small>}
            {posting.weight && <small className="posting-cost">记账权重 {rawAmount(posting.weight.amount)} {posting.weight.currency}</small>}
          </span><span>{rawAmount(posting.amount)} <small>{posting.currency}</small></span>
        </div>)}</div>
        {tx.tags.length > 0 && <div className="transaction-tags">{tx.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
        {tx.links && tx.links.length > 0 && <div className="transaction-tags">{tx.links.map(link => <span key={link}>^{link}</span>)}</div>}
        {usesWeight && <p className="detail-note">记账权重，非现金收付</p>}
      </div>
    </details>
  })}</div>
}
