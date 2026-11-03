import { CalendarRange } from 'lucide-react'
import { billingCycleForDays, normalizeBillingCycle, reportPeriod } from '../domain/period'
import type { BillingCycle } from '../domain/types'

export default function BillingCycleSettings({ cycle, onChange, month }: {
  cycle: BillingCycle
  onChange: (cycle: BillingCycle) => void
  month: string
}) {
  const normalized = normalizeBillingCycle(cycle)
  const period = reportPeriod(month, normalized)
  const startDay = normalized.mode === 'range' || normalized.mode === 'window' ? normalized.startDay! : normalized.day
  const endDay = normalized.mode === 'range' || normalized.mode === 'window' ? normalized.endDay! : normalized.day
  const crossYear = period.start.slice(0, 4) !== period.end.slice(0, 4)
  const dateLabel = (date: string) => (crossYear ? date : date.slice(5)).replaceAll('-', '.')

  return <section className="panel settings-section billing-cycle-settings">
    <div className="section-heading"><h2>账单周期</h2><CalendarRange size={20} className="settings-heading-icon" /></div>
    <div className="billing-cycle-controls">
      <label>开始日<select aria-label="开始日" value={startDay} onChange={event => onChange(billingCycleForDays(Number(event.target.value), endDay))}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日</option>)}
      </select></label>
      <label>结束日<select aria-label="结束日" value={endDay} onChange={event => onChange(billingCycleForDays(startDay, Number(event.target.value)))}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日</option>)}
      </select></label>
    </div>
    <p className="billing-cycle-preview"><span>{Number(month.slice(5))} 月</span><strong><time dateTime={period.start}>{dateLabel(period.start)}</time> – <time dateTime={period.end}>{dateLabel(period.end)}</time></strong></p>
    <p className="billing-cycle-note">{normalized.mode === 'range' ? '已保留原有结束日；修改后结束日不计入本期。' : '结束日不计入本期。'}{startDay < endDay && '相邻周期可能重叠。'}{startDay > endDay && '相邻周期可能有空档。'}{(startDay > 28 || endDay > 28) && '短月取月末。'}</p>
  </section>
}
