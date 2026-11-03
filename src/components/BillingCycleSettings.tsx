import { CalendarRange } from 'lucide-react'
import { billingCycleForStartDay, normalizeBillingCycle, reportPeriod } from '../domain/period'
import type { BillingCycle } from '../domain/types'

export default function BillingCycleSettings({ cycle, onChange, month }: {
  cycle: BillingCycle
  onChange: (cycle: BillingCycle) => void
  month: string
}) {
  const normalized = normalizeBillingCycle(cycle)
  const period = reportPeriod(month, normalized)
  const crossYear = period.start.slice(0, 4) !== period.end.slice(0, 4)
  const dateLabel = (date: string) => (crossYear ? date : date.slice(5)).replaceAll('-', '.')

  return <section className="panel settings-section billing-cycle-settings">
    <div className="section-heading"><h2>账单周期</h2><CalendarRange size={20} className="settings-heading-icon" /></div>
    <div className="billing-cycle-controls">
      <label>每月开始日<select aria-label="每月开始日" value={normalized.day} onChange={event => onChange(billingCycleForStartDay(Number(event.target.value)))}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日{day === 1 ? '（自然月）' : ''}</option>)}
      </select></label>
    </div>
    <p className="billing-cycle-preview"><span>{Number(month.slice(5))} 月</span><strong><time dateTime={period.start}>{dateLabel(period.start)}</time> – <time dateTime={period.end}>{dateLabel(period.end)}</time></strong></p>
    {normalized.day > 28 && <p className="billing-cycle-note">短月取月末。</p>}
  </section>
}
