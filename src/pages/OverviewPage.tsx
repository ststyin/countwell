import { useContext } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, TrendingUp, Wallet } from 'lucide-react'
import { getAccounts, getOverview, getTransactions } from '../domain'
import type { BillingCycle, Ledger } from '../domain/types'
import type { Page, Route } from '../lib/route'
import { CategoryIcon, DisplayContext, EmptyState, Money, SectionTitle } from '../components/ui'
import { formatAmount } from '../lib/format'
import TransactionList from '../components/TransactionList'

export default function OverviewPage({ ledger, month, currency, cycle, onNavigate }: { ledger: Ledger; month: string; currency: string; cycle?: BillingCycle; onNavigate: (page: Page, filters?: Partial<Route>) => void }) {
  const report = getOverview(ledger, month, currency, cycle)
  const accounts = getAccounts(ledger, month, currency, cycle)
  const transactions = getTransactions(ledger, { month, currency, cycle }).slice(0, 5)
  const custom = cycle?.mode === 'custom'
  const { hidden } = useContext(DisplayContext)
  const change = report.expenseChange
  const maxDaily = Math.max(1, ...report.dailyExpenses.map(d => Number(d.amount)))
  const minDaily = Math.min(0, ...report.dailyExpenses.map(d => Number(d.amount)))
  const chartY = (amount: number) => 16 + (maxDaily - amount) / (maxDaily - minDaily) * 127
  const dayCount = report.dailyExpenses.length
  const chartLabels = [0, Math.floor((dayCount - 1) / 3), Math.floor(2 * (dayCount - 1) / 3), dayCount - 1].map(index => {
    const date = report.dailyExpenses[index].date
    return custom ? date.slice(5).replace('-', '.') : `${Number(date.slice(8))} 日`
  })
  return <>
    {report.warnings.map(warning => <div className="notice" key={warning}><span>{warning}</span></div>)}
    <section className="flow-grid" aria-label={custom ? '本期收支' : '本月收支'}>
      <article className="spend-card"><div className="stat-label"><span className="stat-icon expense-tone"><ArrowUpRight size={18} /></span>{custom ? '本期支出' : '本月支出'}{currency !== 'CNY' && <span className="unit-label">{currency}</span>}</div><Money amount={report.flowSupported ? report.expense : null} className="hero-amount" symbol />{change !== null && <div className="stat-footnote"><span className={`change-pill ${change <= 0 ? 'positive' : ''}`}>{hidden ? '••••' : `${change <= 0 ? '↓' : '↑'} ${Math.abs(change).toFixed(1)}%`}</span><span>{custom ? '较上期' : '较上月'}</span></div>}</article>
      <article className="stat-card"><div className="stat-label"><span className="stat-icon income-tone"><ArrowDownLeft size={18} /></span>{custom ? '本期收入' : '本月收入'}</div><Money amount={report.flowSupported ? report.income : null} className="stat-amount" symbol /></article>
      <article className="stat-card"><div className="stat-label"><span className="stat-icon gold-tone"><TrendingUp size={18} /></span>{custom ? '本期结余' : '本月结余'}</div><Money amount={report.flowSupported ? report.surplus : null} className="stat-amount" symbol /></article>
    </section>
    <section className="balance-strip" aria-label="总余额与资产概况"><div className="balance-strip-title"><span className="balance-icon"><Wallet size={20} strokeWidth={1.6} /></span><span>我的钱<span className="balance-date">{custom ? '截至期末' : '截至月末'}{currency !== 'CNY' && ` · ${currency}`}</span></span></div><div className="balance-item"><span className="balance-label">现金与存款</span><Money amount={accounts.cash} /></div><div className="balance-item"><span className="balance-label">待还款</span><Money amount={accounts.liabilities} /></div><div className="balance-item"><span className="balance-label">净资产</span><Money amount={accounts.netWorth} /></div><button className="balance-link" aria-label="查看账户与资产" onClick={() => onNavigate('accounts')}><ChevronRight size={20} /></button></section>
    <div className="dashboard-grid">
      <section className="panel trend-panel"><SectionTitle title="每日净支出" />{report.flowSupported && report.transactionCount ? <><div className="trend-chart"><svg viewBox="0 0 660 160" preserveAspectRatio="none" role="img" aria-label={`${month} 按日净支出，金额单位 ${currency}`}><line x1="0" y1="143" x2="660" y2="143" className="chart-grid-line" /><line x1="0" y1="80" x2="660" y2="80" className="chart-grid-line dashed" /><line x1="0" y1="16" x2="660" y2="16" className="chart-grid-line dashed" />{report.dailyExpenses.map((day, i) => { const height = Math.max(2, Math.abs(chartY(Number(day.amount)) - chartY(0))); return <rect key={day.date} x={i * 660 / dayCount + 3} y={Number(day.amount) < 0 ? chartY(0) : chartY(0) - height} width={Math.max(3, 660 / dayCount - 7)} height={height} rx="3" className={Number(day.amount) < 0 ? 'chart-bar refund-bar' : 'chart-bar'}><title>{hidden ? `${day.date} 金额已隐藏` : `${day.date}：${formatAmount(day.amount)}${currency !== 'CNY' ? ` ${currency}` : ''}`}</title></rect> })}</svg></div><div className="chart-labels">{chartLabels.map((label, index) => <span key={index}>{label}</span>)}</div></> : <EmptyState title={report.flowSupported ? (custom ? '本期暂无交易' : '本月暂无交易') : (custom ? '本期收支暂不可汇总' : '本月收支暂不可汇总')} />}</section>
      <section className="panel category-panel"><SectionTitle title="支出分类" action="全部" onAction={() => onNavigate('transactions', { kind: 'expense' })} />{report.categories.length ? <div className="category-list">{report.categories.slice(0, 5).map((category, i) => <button className="category-row" key={category.account} onClick={() => onNavigate('transactions', { account: category.account })}><span className={`category-icon category-color-${i % 5}`}><CategoryIcon name={category.name} /></span><span className="category-copy"><span className="category-name">{category.name}</span><span className="category-track"><span style={{ width: `${Math.max(0, Math.min(100, category.share))}%` }} className={`category-fill category-color-${i % 5}`} /></span></span><span className="category-amount"><Money amount={category.amount} /><span>{hidden ? '••' : `${category.share.toFixed(0)}%`}</span></span></button>)}</div> : <EmptyState title={report.flowSupported ? '暂无消费支出' : '分类合计暂不可用'} />}</section>
    </div>
    <section className="panel recent-panel"><SectionTitle title="最近交易" subtitle={`${report.transactionCount} 笔交易${report.pendingCount ? ` · ${report.pendingCount} 笔待核对` : ''}`} action="全部交易" onAction={() => onNavigate('transactions')} /><TransactionList transactions={transactions} /></section>
  </>
}
