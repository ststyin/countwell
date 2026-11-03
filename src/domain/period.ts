import type { BillingCycle, ReportingPeriod } from './types';

export const DEFAULT_BILLING_CYCLE: BillingCycle = { mode: 'calendar', day: 1, boundary: 'start' };

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

/** Calendar months or a continuous recurring cycle, with short-month anchors clamped. */
export function reportPeriod(month: string, cycle: BillingCycle = DEFAULT_BILLING_CYCLE): ReportingPeriod {
  const calendar = monthBounds(month);
  if (!cycle || !['calendar', 'custom'].includes(cycle.mode) || !Number.isInteger(cycle.day)
      || cycle.day < 1 || cycle.day > 31 || !['start', 'end'].includes(cycle.boundary)) throw new Error('账单周期设置无效');
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
  // The custom period named for this calendar month ends at its anchor;
  // dates after that anchor belong to the following labelled month.
  return followingDate(calendar.end).slice(0, 7);
}
