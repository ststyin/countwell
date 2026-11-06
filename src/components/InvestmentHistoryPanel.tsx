import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Ledger, summarizeInvestments } from '../domain'
import { investmentLabels } from '../lib/investmentLabels'
import { Gain } from './InvestmentPanel'
import { Money, SectionTitle } from './ui'

type History = ReturnType<typeof summarizeInvestments>
type Totals = History['historyTotals'][number]
type Fund = History['history'][number]

function HistoryAmounts({ row }: { row: Totals | Fund }) {
  return <dl className="investment-history-amounts">
    <div><dt>当前市值</dt><dd><Money amount={row.marketValue} currency={row.currency} /></dd></div>
    <div><dt>累计投入</dt><dd><Money amount={row.invested} currency={row.currency} /></dd></div>
    <div><dt>卖出净收回</dt><dd><Money amount={row.withdrawn} currency={row.currency} /></dd></div>
    <div><dt>买卖已实现盈亏</dt><dd><Gain amount={row.realizedPnl} currency={row.currency} /></dd></div>
    <div><dt>已确认现金分红</dt><dd><Gain amount={row.dividends} currency={row.currency} /></dd></div>
  </dl>
}

export default function InvestmentHistoryPanel({ summary, ledger, onAccount }: { summary: History; ledger: Ledger; onAccount: (account: string) => void }) {
  const { history, historyTotals, unallocatedDividends } = summary
  if (!history.length) return null
  const names = investmentLabels(ledger)
  const unknownCurrency = history.filter(fund => !fund.currency).length
  return <section className="panel investment-history-panel">
    <SectionTitle title="投资历史收益" subtitle="全账本 · 包含已清仓基金 · 按币种分别统计" />
    {historyTotals.map(total => <div className="investment-history-total" key={total.currency}>
      <div className="investment-history-total-heading">
        <span>累计盈亏 · {total.currency} · {total.count} 项{total.cumulativePnl === null && ' · 部分金额待确认'}</span>
        <Gain amount={total.cumulativePnl} currency={total.currency} />
      </div>
      <HistoryAmounts row={total} />
    </div>)}
    <p className="investment-caption">累计盈亏 = 当前市值 + 卖出净收回 + 已确认现金分红 − 累计投入。分红单列，未计入买卖已实现盈亏。</p>
    {unknownCurrency > 0 && <p className="investment-caption">{unknownCurrency} 项币种待确认，单列于下方。</p>}
    {unallocatedDividends > 0 && <p className="investment-caption">{unallocatedDividends} 笔分红交易暂无法归属或计价，未纳入统计。</p>}
    <div className="position-list">{history.map(fund => <details className="investment-item investment-history-fund" key={JSON.stringify([fund.account, fund.commodity])}>
      <summary className="investment-history-fund-heading">
        <span className="investment-item-name">
          <strong>{names.get(fund.account) ?? fund.accountLabel}</strong>
          <small>{fund.commodity} · {fund.closed ? '已清仓' : '在持'} · {fund.currency || '币种待确认'}</small>
        </span>
        <span className="investment-item-value"><small>累计盈亏</small><Gain amount={fund.cumulativePnl} currency={fund.currency} /></span>
        <ChevronDown size={16} className="investment-chevron" />
      </summary>
      <div className="investment-item-detail">
        <HistoryAmounts row={fund} />
        {fund.cumulativePnl === null && <p className="holding-note">累计盈亏待确认。请核对成交收付、转仓、成本币种及当前报价。</p>}
        <div className="holding-account-link"><span>{fund.accountLabel}</span><button type="button" className="text-action investment-transactions" onClick={() => onAccount(fund.account)}>查看账户交易 <ChevronRight size={15} /></button></div>
      </div>
    </details>)}</div>
  </section>
}
