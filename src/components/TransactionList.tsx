import { useContext } from 'react'
import { ArrowRight, ChevronDown, CircleAlert } from 'lucide-react'
import type { Activity } from '../domain/types'
import { CategoryIcon, DisplayContext, EmptyState, Money } from './ui'
import { shortDate } from '../lib/format'

export const kindLabels = { income: '收入', expense: '支出', refund: '退款', transfer: '转账', investment: '投资' }

export default function TransactionList({ transactions }: { transactions: Activity[] }) {
  const { hidden } = useContext(DisplayContext)
  const rawAmount = (amount: string) => <span className="money">{hidden ? '••••' : amount}</span>
  if (!transactions.length) return <EmptyState title="暂无交易" description="" />
  return <div className="transaction-list">{transactions.map(tx => {
    const sign = tx.amountUnavailable ? '' : tx.direction === 'out' ? '−' : tx.direction === 'in' ? '+' : ''
    const label = tx.kind === 'refund' ? '冲减支出' : tx.kind === 'transfer' ? '账户转账' : tx.kind === 'investment' ? '持仓变动' : tx.category
    const primaryIndex = tx.amounts?.findIndex(amount => amount.amount === tx.amount && amount.currency === tx.currency && amount.direction === tx.direction && amount.kind === tx.kind && amount.basis === tx.amountBasis) ?? -1
    const otherAmounts = tx.amounts?.filter((_, index) => index !== primaryIndex) ?? []
    const usesWeight = tx.amountBasis === 'weight' || otherAmounts.some(amount => amount.basis === 'weight')
    return <details className={`transaction-row transaction-${tx.kind} direction-${tx.direction}`} key={tx.id}>
      <summary>
        <span className={`transaction-icon ${tx.kind}-icon`}><CategoryIcon name={tx.category} kind={tx.kind} size={19} /></span>
        <span className="transaction-info"><span className="transaction-title">{tx.narration.trim() || '无描述交易'}<span className="transaction-kind">{kindLabels[tx.kind]}</span>{tx.flag === '!' && <CircleAlert size={13} className="pending-indicator" aria-label="待核对" />}</span><span className="transaction-subtitle">{shortDate(tx.date)}<span className="mini-dot" />{label}{tx.amountBasis === 'weight' ? ' · 记账权重' : ''}</span></span>
        <span className={`transaction-amount ${tx.direction === 'in' ? 'income-tone' : tx.direction === 'out' ? 'expense-tone' : ''}`}>{!hidden && sign}<Money amount={tx.amountUnavailable ? null : tx.amount} currency={tx.currency} />{tx.currency !== 'CNY' && <small>{tx.currency}</small>}{tx.amountUnavailable && <small>金额待确认</small>}{otherAmounts.map((amount, index) => <small key={index}>{kindLabels[amount.kind]} {hidden ? '••••' : `${amount.direction === 'in' ? '+' : amount.direction === 'out' ? '−' : ''}${amount.amount}`}{amount.currency !== 'CNY' && ` ${amount.currency}`}{amount.basis === 'weight' ? ' · 权重' : ''}</small>)}</span>
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
