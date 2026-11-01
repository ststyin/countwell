import { useContext } from 'react'
import { ArrowRight, ChevronDown, CircleAlert } from 'lucide-react'
import type { Activity } from '../domain/types'
import { CategoryIcon, DisplayContext, EmptyState, Money } from './ui'
import { shortDate } from '../lib/format'

export const kindLabels = { income: '收入', expense: '支出', refund: '退款', transfer: '转账', investment: '投资' }

export default function TransactionList({ transactions }: { transactions: Activity[] }) {
  const { hidden } = useContext(DisplayContext)
  if (!transactions.length) return <EmptyState title="没有找到这类记录" description="试试切换月份，或者调整筛选条件。" />
  return <div className="transaction-list">{transactions.map(tx => {
    const sign = tx.direction === 'out' ? '−' : tx.direction === 'in' ? '+' : ''
    const label = tx.kind === 'refund' ? '冲减支出' : tx.kind === 'transfer' ? '账户间转账，不计入收支' : tx.kind === 'investment' ? '投资变动，不计入消费' : tx.category
    return <details className={`transaction-row transaction-${tx.kind}`} key={tx.id}><summary><span className={`transaction-icon ${tx.kind}-icon`}><CategoryIcon name={tx.category} kind={tx.kind} size={19} /></span><span className="transaction-info"><span className="transaction-title">{tx.payee || tx.narration}<span className="transaction-kind">{kindLabels[tx.kind]}</span>{tx.flag === '!' && <CircleAlert size={13} className="pending-indicator" aria-label="待核对" />}</span><span className="transaction-subtitle">{shortDate(tx.date)}<span className="mini-dot" />{label}</span></span><span className={`transaction-amount ${tx.kind === 'income' || tx.kind === 'refund' ? 'income-tone' : tx.kind === 'expense' ? 'expense-tone' : ''}`}>{!hidden && sign}<Money amount={tx.amount} currency={tx.currency} /><small>{tx.currency}</small></span><ChevronDown size={15} className="transaction-chevron" /></summary><div className="transaction-details"><div className="transaction-detail-header"><span>{tx.narration}</span><span>{tx.flag === '!' ? '待核对' : '已确认'}</span></div>{tx.kind === 'transfer' && <p className="transfer-description">{tx.fromAccount && <>{tx.fromAccount}<ArrowRight size={13} />{tx.toAccount}</>}<span>账户之间的钱发生了转移，总收入与总支出保持不变。</span></p>}<div className="posting-header"><span>复式分录</span><span>原始记账符号</span></div><div className="posting-list">{tx.postings.map((p, index) => <div className="posting-row" key={index}><code>{p.account}</code><span><Money amount={p.amount} currency={p.currency} /> <small>{p.currency}</small></span></div>)}</div>{tx.tags.length > 0 && <div className="transaction-tags">{tx.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}<p className="detail-note">日常金额按交易含义显示，原始分录保留借贷方向。</p></div></details>
  })}</div>
}
