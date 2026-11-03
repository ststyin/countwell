import type { BillingCycle, ReportingPeriod } from './types';

export const DEFAULT_BILLING_CYCLE: BillingCycle = { mode: 'calendar', day: 1, boundary: 'start' };

/** The first day selects calendar months; every other day starts a continuous cycle. */
export function billingCycleForStartDay(day: number): BillingCycle {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('账单周期设置无效');
  return day === 1 ? { ...DEFAULT_BILLING_CYCLE } : { mode: 'custom', day, boundary: 'start' };
}

/** Independent start and exclusive end anchors; matching days retain continuous cycles. */
export function billingCycleForDays(startDay: number, endDay: number): BillingCycle {
  for (const day of [startDay, endDay]) if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('账单周期设置无效');
  return startDay === endDay ? billingCycleForStartDay(startDay) : { mode: 'window', day: startDay, boundary: 'start', startDay, endDay };
}

/** Preserve independently saved ranges and normalize legacy single-boundary cycles. */
export function normalizeBillingCycle(cycle: BillingCycle): BillingCycle {
  if (cycle.mode === 'calendar') return { ...DEFAULT_BILLING_CYCLE };
  if (cycle.mode === 'range' || cycle.mode === 'window') return { mode: cycle.mode, day: cycle.day, boundary: cycle.boundary, startDay: cycle.startDay, endDay: cycle.endDay };
  const startDay = cycle.boundary === 'end' ? (cycle.day === 31 ? 1 : cycle.day + 1) : cycle.day;
  return billingCycleForStartDay(startDay);
}

export function monthBounds(month: string): { start: string; end: string; days: number; previous: string } {
  if (typeof month !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份必须为 YYYY-MM');
  const [year, number] = month.split('-').map(Number);
  if (year === 0) throw new Error('年份必须大于零');
  const days = number === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(number) ? 30 : 31;
  const previous = number === 1 ? `${String(year - 1).padStart(4, '0')}-12` : `${String(year).padStart(4, '0')}-${String(number - 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${month}-${days}`, days, previous };
}

function dateAt(month: string, day: number): string {
  return `${month}-${String(Math.min(day, monthBounds(month).days)).padStart(2, '0')}`;
}

function followingDate(iso: string, offset = 1): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  // setUTCFullYear avoids Date.UTC's special interpretation of years 0–99.
  date.setUTCFullYear(year, month - 1, day + offset);
  const resultYear = date.getUTCFullYear();
  if (resultYear < 1 || resultYear > 9999) throw new Error('账单周期超出支持的年份范围');
  return `${String(resultYear).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Calendar months or recurring cycles, with short-month anchors clamped. */
export function reportPeriod(month: string, cycle: BillingCycle = DEFAULT_BILLING_CYCLE): ReportingPeriod {
  const calendar = monthBounds(month);
  if (!cycle || !['calendar', 'custom', 'range', 'window'].includes(cycle.mode) || !Number.isInteger(cycle.day)
      || cycle.day < 1 || cycle.day > 31 || !['start', 'end'].includes(cycle.boundary)) throw new Error('账单周期设置无效');
  if ((cycle.mode === 'range' || cycle.mode === 'window') && (!Number.isInteger(cycle.startDay) || !Number.isInteger(cycle.endDay)
      || cycle.startDay! < 1 || cycle.startDay! > 31 || cycle.endDay! < 1 || cycle.endDay! > 31)) throw new Error('账单周期设置无效');
  let { start, end } = calendar;
  if (cycle.mode === 'custom') {
    const before = dateAt(calendar.previous, cycle.day);
    const current = dateAt(month, cycle.day);
    if (cycle.boundary === 'start') {
      start = before;
      end = followingDate(current, -1);
    } else {
      start = followingDate(before);
      end = current;
    }
  } else if (cycle.mode === 'range') {
    start = dateAt(calendar.previous, cycle.startDay!);
    end = dateAt(month, cycle.endDay!);
  } else if (cycle.mode === 'window') {
    start = dateAt(calendar.previous, cycle.startDay!);
    end = followingDate(dateAt(month, cycle.endDay!), -1);
  }
  const dates: string[] = [];
  for (let current = start; current <= end; current = followingDate(current)) {
    dates.push(current);
    if (current === end) break;
  }
  return { start, end, days: dates.length, previous: calendar.previous, dates };
}

/** Find the labelled reporting month that contains an actual ledger date. */
export function billingMonthForDate(iso: string, cycle: BillingCycle = DEFAULT_BILLING_CYCLE): string {
  if (typeof iso !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(iso)) throw new Error('日期必须为 YYYY-MM-DD');
  const month = iso.slice(0, 7);
  const calendar = monthBounds(month);
  const day = Number(iso.slice(8));
  if (day < 1 || day > calendar.days) throw new Error('日期无效');
  const period = reportPeriod(month, cycle);
  if (iso >= period.start && iso <= period.end) return month;
  // With overlapping periods, prefer the period ending in this month. In a
  // gap, use the following labelled month even though the date is not in it.
  return followingDate(calendar.end).slice(0, 7);
}
