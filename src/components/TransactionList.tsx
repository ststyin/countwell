import { Fragment, useContext } from 'react'
import { ArrowRight, ChevronDown, CircleAlert } from 'lucide-react'
import type { Activity, ActivityAmount } from '../domain/types'
import { CategoryIcon, DisplayContext, EmptyState, Money } from './ui'
import { formatAmount, formatShares, shortDate } from '../lib/format'

export const kindLabels = { income: '收入', expense: '支出', refund: '退款', transfer: '转账', investment: '投资' }

type Settlement = NonNullable<Activity['investmentSettlement']>
type CashFlow = Settlement['cashFlows'][number]

function cashFlowLabel(flow: CashFlow) {
  const account = flow.accountLabel.toLowerCase() === 'alipay' ? '支付宝' : flow.accountLabel
  return `${account}${flow.direction === 'in' ? '到账' : '付款'}`
}

function InvestmentDetails({ settlement, primaryCash }: { settlement: Settlement; primaryCash?: CashFlow }) {
  const { hidden } = useContext(DisplayContext)
  return <dl className="investment-trade-details">
    {settlement.trades.map(trade => {
      const name = settlement.trades.length === 1 ? '' : `${trade.commodity} ${trade.direction === 'buy' ? '买入' : '卖出'} `
      return <Fragment key={JSON.stringify([trade.account, trade.commodity, trade.direction])}>
        <div><dt>{name}份额</dt><dd><span className="money" aria-label={hidden ? '份额已隐藏' : undefined}>{hidden ? '••••' : formatShares(trade.units)}</span> 份</dd></div>
        {trade.price && <div><dt>{name}单价</dt><dd><Money amount={trade.price.amount} decimals={4} /> {trade.price.currency === 'CNY' ? '元' : trade.price.currency}</dd></div>}
      </Fragment>
    })}
    {settlement.cashFlows.filter(flow => flow !== primaryCash).map(flow => <div key={JSON.stringify([flow.account, flow.currency])}>
      <dt>{cashFlowLabel(flow)}</dt><dd>{!hidden && (flow.direction === 'in' ? '+' : '−')}<Money amount={flow.amount} /> {flow.currency === 'CNY' ? '元' : flow.currency}</dd>
    </div>)}
    {settlement.fees.map(fee => <div key={fee.currency}>
      <dt>手续费</dt><dd><Money amount={fee.amount} /> {fee.currency === 'CNY' ? '元' : fee.currency}</dd>
    </div>)}
  </dl>
}

function LedgerDetails({ transaction: tx, usesWeight }: { transaction: Activity; usesWeight: boolean }) {
  const { hidden } = useContext(DisplayContext)
  const settlement = tx.investmentSettlement
  const rawAmount = (amount: string) => <span className="money">{hidden ? '••••' : amount}</span>
  const unitPrice = (amount: string) => settlement ? <Money amount={amount} decimals={4} /> : rawAmount(amount)
  return <>
    <div className="transaction-detail-header"><span>{tx.payee.trim() || '未填写'}</span><span>{tx.flag === '!' ? '待核对' : tx.flag === '*' ? '已确认' : `交易标记：${tx.flag}`}</span></div>
    {tx.kind === 'transfer' && tx.fromAccount && <p className="transfer-description">{tx.fromAccount}<ArrowRight size={13} />{tx.toAccount}</p>}
    {!settlement && <div className="posting-header"><span>复式分录</span></div>}
    <div className="posting-list">{tx.postings.map((posting, index) => {
      const shares = settlement?.trades.some(trade => trade.commodity === posting.currency)
      const amount = settlement ? (shares ? formatShares(posting.amount) : formatAmount(posting.amount)) : posting.amount
      return <div className="posting-row" key={index}>
        <span className="posting-account"><code>{posting.account}</code>
          {posting.flag && <small className="posting-cost">分录标记：{posting.flag}</small>}
          {posting.cost && <small className="posting-cost">每份成本 {unitPrice(posting.cost.amount)} {posting.cost.currency}{posting.cost.date ? ` · ${posting.cost.date}` : ''}{posting.cost.label ? ` · ${posting.cost.label}` : ''}</small>}
          {posting.price && <small className="posting-cost">交易单价 {unitPrice(posting.price.amount)} {posting.price.currency}</small>}
          {!settlement && posting.weight && <small className="posting-cost">记账权重 {rawAmount(posting.weight.amount)} {posting.weight.currency}</small>}
        </span><span>{rawAmount(amount)} <small>{posting.currency}</small></span>
      </div>
    })}</div>
    {tx.tags.length > 0 && <div className="transaction-tags">{tx.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}
    {tx.links && tx.links.length > 0 && <div className="transaction-tags">{tx.links.map(link => <span key={link}>^{link}</span>)}</div>}
    {!settlement && usesWeight && <p className="detail-note">记账权重，非现金收付</p>}
  </>
}

function amountLabel(amount: ActivityAmount) {
  if (amount.kind === 'investment' && amount.direction !== 'internal') return amount.direction === 'out' ? '已实现亏损' : '已实现盈利'
  return kindLabels[amount.kind]
}

export default function TransactionList({ transactions }: { transactions: Activity[] }) {
  const { hidden } = useContext(DisplayContext)
  if (!transactions.length) return <EmptyState title="暂无交易" description="" />
  return <div className="transaction-list">{transactions.map(tx => {
    const settlement = tx.investmentSettlement
    const primaryCash = settlement?.cashFlows.length === 1 ? settlement.cashFlows[0] : undefined
    const direction = settlement ? primaryCash?.direction ?? 'internal' : tx.direction
    const displayKind = settlement ? 'investment' : tx.kind
    const sign = tx.amountUnavailable ? '' : direction === 'out' ? '−' : direction === 'in' ? '+' : ''
    const tradeLabel = settlement?.action === 'sell' ? '卖出' : settlement?.action === 'buy' ? '买入' : '持仓变动'
    const title = tx.narration.trim() || (settlement ? tradeLabel : '无描述交易')
    const badge = settlement ? title.startsWith(tradeLabel) ? null : tradeLabel : kindLabels[displayKind]
    const label = settlement
      ? primaryCash ? cashFlowLabel(primaryCash) : settlement.cashFlows.length > 1 ? '分笔收付' : ''
      : tx.kind === 'refund' ? '冲减支出' : tx.kind === 'transfer' ? '账户转账' : tx.category
    const primaryIndex = tx.amounts?.findIndex(amount => amount.amount === tx.amount && amount.currency === tx.currency && amount.direction === tx.direction && amount.kind === tx.kind && amount.basis === tx.amountBasis) ?? -1
    const otherAmounts = settlement ? [] : tx.amounts?.filter((_, index) => index !== primaryIndex) ?? []
    const usesWeight = tx.amountBasis === 'weight' || tx.amounts?.some(amount => amount.basis === 'weight') === true
    const amount = tx.amountUnavailable ? null : primaryCash?.amount ?? tx.amount
    const currency = primaryCash?.currency ?? tx.currency
    const ledgerDetails = <LedgerDetails transaction={tx} usesWeight={usesWeight} />
    return <details className={`transaction-row transaction-${displayKind} direction-${direction}`} key={`${tx.id}:${tx.currency}`}>
      <summary>
        <span className={`transaction-icon ${displayKind}-icon`}><CategoryIcon name={settlement ? tradeLabel : tx.category} kind={displayKind} size={19} /></span>
        <span className="transaction-info">
          <span className="transaction-title">{title}{badge && <span className="transaction-kind">{badge}</span>}{tx.flag === '!' && <CircleAlert size={13} className="pending-indicator" aria-label="待核对" />}</span>
          <span className="transaction-subtitle">{shortDate(tx.date)}{label && <><span className="mini-dot" />{label}</>}{!settlement && tx.amountBasis === 'weight' ? ' · 记账权重' : ''}</span>
        </span>
        <span className={`transaction-amount ${direction === 'in' ? 'income-tone' : direction === 'out' ? 'expense-tone' : ''}`}>
          {(!settlement || primaryCash) && <>{!hidden && sign}<Money amount={amount} currency={currency} />
            {currency !== 'CNY' && <small>{currency}</small>}{tx.amountUnavailable && <small>金额待确认</small>}</>}
          {otherAmounts.map((amount, index) => <small key={index}>{amountLabel(amount)} {hidden ? '••••' : `${amount.direction === 'in' ? '+' : amount.direction === 'out' ? '−' : ''}${formatAmount(amount.amount)}`}{amount.currency !== 'CNY' && ` ${amount.currency}`}{amount.basis === 'weight' ? ' · 权重' : ''}</small>)}
        </span>
        <ChevronDown size={15} className="transaction-chevron" />
      </summary>
      <div className="transaction-details">
        {settlement ? <>
          <InvestmentDetails settlement={settlement} primaryCash={primaryCash} />
          <details className="transaction-ledger-details">
            <summary>账本分录<ChevronDown size={13} aria-hidden="true" /></summary>
            {ledgerDetails}
          </details>
        </> : ledgerDetails}
      </div>
    </details>
  })}</div>
}
