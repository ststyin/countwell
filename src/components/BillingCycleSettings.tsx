import { CalendarRange } from 'lucide-react'
import { DEFAULT_BILLING_CYCLE, reportPeriod } from '../domain/period'
import type { BillingCycle } from '../domain/types'

export default function BillingCycleSettings({ cycle, onChange, month }: {
  cycle: BillingCycle
  onChange: (cycle: BillingCycle) => void
  month: string
}) {
  const mode = cycle.mode === 'calendar' ? 'calendar' : cycle.mode === 'range' ? 'range' : cycle.boundary
  const period = reportPeriod(month, cycle)
  const crossYear = period.start.slice(0, 4) !== period.end.slice(0, 4)
  const dateLabel = (date: string) => (crossYear ? date : date.slice(5)).replaceAll('-', '.')

  return <section className="panel settings-section billing-cycle-settings">
    <div className="section-heading"><h2>账单周期</h2><CalendarRange size={20} className="settings-heading-icon" /></div>
    <div className="billing-cycle-controls">
      <label>统计方式<select aria-label="账单周期" value={mode} onChange={event => {
        const next = event.target.value
        if (next === 'calendar') onChange({ ...DEFAULT_BILLING_CYCLE })
        else if (next === 'range') onChange({ mode: 'range', day: cycle.day, boundary: cycle.boundary, startDay: Number(period.start.slice(8)), endDay: Number(period.end.slice(8)) })
        else if (next === 'start' || next === 'end') onChange({ mode: 'custom', day: cycle.mode === 'custom' ? cycle.day : 25, boundary: next })
      }}>
        <option value="calendar">自然月</option>
        <option value="start">按开始日</option>
        <option value="end">按截止日</option>
        <option value="range">自定义起止日</option>
      </select></label>
      {cycle.mode === 'custom' && <label>{cycle.boundary === 'start' ? '开始日' : '截止日'}<select aria-label="账单日" value={cycle.day} onChange={event => onChange({ ...cycle, day: Number(event.target.value) })}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日</option>)}
      </select></label>}
      {cycle.mode === 'range' && <><label>上月开始日<select aria-label="上月开始日" value={cycle.startDay} onChange={event => onChange({ ...cycle, startDay: Number(event.target.value) })}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日</option>)}
      </select></label><label>本月结束日<select aria-label="本月结束日" value={cycle.endDay} onChange={event => onChange({ ...cycle, endDay: Number(event.target.value) })}>
        {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option value={day} key={day}>{day} 日</option>)}
      </select></label></>}
    </div>
    <p className="billing-cycle-preview"><span>{Number(month.slice(5))} 月</span><strong><time dateTime={period.start}>{dateLabel(period.start)}</time> – <time dateTime={period.end}>{dateLabel(period.end)}</time></strong></p>
    {cycle.mode === 'custom' && <p className="billing-cycle-note">{cycle.day} 日计入{cycle.boundary === 'start' ? '新一期' : '本期'}{cycle.day > 28 ? '，短月取月末' : ''}。</p>}
    {cycle.mode === 'range' && <p className="billing-cycle-note">首尾日期均计入，短月取月末。{cycle.startDay! <= cycle.endDay! ? '相邻周期可能重叠。' : cycle.startDay! > cycle.endDay! + 1 ? '相邻周期可能有空档。' : ''}</p>}
  </section>
}
