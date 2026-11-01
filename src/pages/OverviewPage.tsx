import { useContext } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, TrendingUp, Wallet } from 'lucide-react'
import { getAccounts, getOverview, getTransactions } from '../domain'
import type { Ledger } from '../domain/types'
import type { Page, Route } from '../lib/route'
import { CategoryIcon, DisplayContext, EmptyState, Money, SectionTitle } from '../components/ui'
import { formatAmount, percentageChange } from '../lib/format'
import TransactionList from '../components/TransactionList'

export default function OverviewPage({ ledger, month, currency, onNavigate }: { ledger: Ledger; month: string; currency: string; onNavigate: (page: Page, filters?: Partial<Route>) => void }) {
  const report = getOverview(ledger, month, currency)
  const accounts = getAccounts(ledger, month, currency)
  const transactions = getTransactions(ledger, { month, currency }).slice(0, 5)
  const { hidden } = useContext(DisplayContext)
  const change = percentageChange(report.expense, report.previousExpense)
  const maxDaily = Math.max(1, ...report.dailyExpenses.map(d => Number(d.amount)))
  const minDaily = Math.min(0, ...report.dailyExpenses.map(d => Number(d.amount)))
  const chartY = (amount: number) => 16 + (maxDaily - amount) / (maxDaily - minDaily) * 127
  const dayCount = report.dailyExpenses.length
  return <>
    <section className="flow-grid" aria-label="本月收支">
      <article className="spend-card"><div className="stat-label"><span className="stat-icon expense-tone"><ArrowUpRight size={18} /></span>本月支出 <span className="unit-label">{currency}</span></div><Money amount={report.expense} className="hero-amount" symbol /><div className="stat-footnote">{change === null ? <span>上月暂无支出记录</span> : <><span className={`change-pill ${change <= 0 ? 'positive' : ''}`}>{hidden ? '••••' : `${change <= 0 ? '↓' : '↑'} ${Math.abs(change).toFixed(1)}%`}</span><span>相比上个月</span></>}<span className="footnote-divider">·</span><span>已扣退款</span></div></article>
      <article className="stat-card"><div className="stat-label"><span className="stat-icon income-tone"><ArrowDownLeft size={18} /></span>本月收入</div><Money amount={report.income} className="stat-amount" symbol /><p className="stat-footnote">来自{report.incomeCategories.length || '—'}项收入来源</p></article>
      <article className="stat-card"><div className="stat-label"><span className="stat-icon gold-tone"><TrendingUp size={18} /></span>本月结余</div><Money amount={report.surplus} className="stat-amount" symbol /><p className="stat-footnote">收入减去净支出</p></article>
    </section>
    <section className="balance-strip" aria-label="总余额与资产概况"><div className="balance-strip-title"><span className="balance-icon"><Wallet size={20} strokeWidth={1.6} /></span><span>我的钱<span className="balance-date">截至月末 · {currency}</span></span></div><div className="balance-item"><span className="balance-label">现金与存款</span><Money amount={accounts.cash} /></div><div className="balance-item"><span className="balance-label">待还款</span><Money amount={accounts.liabilities} /></div><div className="balance-item"><span className="balance-label">净资产</span><Money amount={accounts.netWorth} /></div><button className="balance-link" aria-label="查看账户与资产" onClick={() => onNavigate('accounts')}><ChevronRight size={20} /></button></section>
    <div className="dashboard-grid">
      <section className="panel trend-panel"><SectionTitle title="支出的日常节奏" subtitle={`${Number(month.split('-')[1])} 月 · 每日净支出`} /><div className="chart-meta"><span className="legend-dot" /><span>每日支出</span><span className="chart-unit">{currency}</span></div>{report.transactionCount ? <><div className="trend-chart"><svg viewBox="0 0 660 160" preserveAspectRatio="none" role="img" aria-label={`${month} 按日净支出，金额单位 ${currency}`}><line x1="0" y1="143" x2="660" y2="143" className="chart-grid-line" /><line x1="0" y1="80" x2="660" y2="80" className="chart-grid-line dashed" /><line x1="0" y1="16" x2="660" y2="16" className="chart-grid-line dashed" />{report.dailyExpenses.map((day, i) => { const height = Math.max(2, Math.abs(chartY(Number(day.amount)) - chartY(0))); return <rect key={day.date} x={i * 660 / dayCount + 3} y={Number(day.amount) < 0 ? chartY(0) : chartY(0) - height} width={Math.max(3, 660 / dayCount - 7)} height={height} rx="3" className={Number(day.amount) < 0 ? 'chart-bar refund-bar' : 'chart-bar'}><title>{hidden ? `${day.date} 金额已隐藏` : `${day.date}：${formatAmount(day.amount)} ${currency}`}</title></rect> })}</svg></div><div className="chart-labels"><span>1 日</span><span>10 日</span><span>20 日</span><span>{dayCount} 日</span></div></> : <EmptyState title="这个月还很安静" description="没有记录时，我们会把这里留白。" />}</section>
      <section className="panel category-panel"><SectionTitle title="钱花在哪里" subtitle="按净支出分类" action="全部" onAction={() => onNavigate('transactions', { kind: 'expense' })} />{report.categories.length ? <div className="category-list">{report.categories.slice(0, 5).map((category, i) => <button className="category-row" key={category.account} onClick={() => onNavigate('transactions', { account: category.account })}><span className={`category-icon category-color-${i % 5}`}><CategoryIcon name={category.name} /></span><span className="category-copy"><span className="category-name">{category.name}</span><span className="category-track"><span style={{ width: `${Math.max(0, Math.min(100, category.share))}%` }} className={`category-fill category-color-${i % 5}`} /></span></span><span className="category-amount"><Money amount={category.amount} /><span>{hidden ? '••' : `${category.share.toFixed(0)}%`}</span></span></button>)}</div> : <EmptyState title="暂无消费支出" description="切换月份，看看其他时候的生活。" />}</section>
    </div>
    <section className="panel recent-panel"><SectionTitle title="最近的几笔" subtitle={`${report.transactionCount} 笔交易${report.pendingCount ? ` · ${report.pendingCount} 笔待核对` : ''}`} action="查看全部交易" onAction={() => onNavigate('transactions')} /><TransactionList transactions={transactions} /></section>
  </>
}
