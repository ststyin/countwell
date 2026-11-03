import { CalendarRange } from 'lucide-react'
import { DEFAULT_BILLING_CYCLE, reportPeriod } from '../domain/period'
import type { BillingCycle } from '../domain/types'

export default function BillingCycleSettings({ cycle, onChange, month }: {
  cycle: BillingCycle
  onChange: (cycle: BillingCycle) => void
  month: string
}) {
  const mode = cycle.mode === 'calendar' ? 'calendar' : cycle.boundary
  const period = reportPeriod(month, cycle)
  const crossYear = period.start.slice(0, 4) !== period.end.slice(0, 4)
  const dateLabel = (date: string) => (crossYear ? date : date.slice(5)).replaceAll('-', '.')

  return <section className="panel settings-section billing-cycle-settings">
    <div className="section-heading"><h2>账单周期</h2><CalendarRange size={20} className="settings-heading-icon" /></div>
    <div className="billing-cycle-controls">
      <label>统计方式<select aria-label="账单周期" value={mode} onChange={event => {
        const next = event.target.value
        if (next === 'calendar') onChange({ ...DEFAULT_BILLING_CYCLE })
        else if (next === 'start' || next === 'end') onChange({ mode: 'custom', day: cycle.mode === 'custom' ? cycle.day : 25, boundary: next })
      }}>
        <option value="calendar">自然月</option>
        <option value="start">按开始日</option>
        <option value="end">按截止日</option>
      </select></label>
      {cycle.mode === 'custom' && <label>{cycle.boundary === 'start' ? '开始日' : '截止日'}<select aria-label="账单日" value={cycle.day} onChange={event => onChange({ ...cycle, day: Number(event.target.value) })}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日</option>)}
      </select></label>}
    </div>
    <p className="billing-cycle-preview"><span>{Number(month.slice(5))} 月</span><strong><time dateTime={period.start}>{dateLabel(period.start)}</time> – <time dateTime={period.end}>{dateLabel(period.end)}</time></strong></p>
    {cycle.mode === 'custom' && <p className="billing-cycle-note">{cycle.day} 日计入{cycle.boundary === 'start' ? '新一期' : '本期'}{cycle.day > 28 ? '，短月取月末' : ''}。</p>}
  </section>
}
