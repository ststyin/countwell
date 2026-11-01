import Decimal from 'decimal.js'

export const currencySymbols: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', HKD: 'HK$' }

export function formatAmount(value: string | number, decimals = 2): string {
  const fixed = new Decimal(value).toFixed(decimals)
  const [integer, fraction] = fixed.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '')
}

export function monthLabel(month: string): string {
  const [year, number] = month.split('-')
  return `${year} 年 ${Number(number)} 月`
}

export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, number - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`
}

export function percentageChange(current: string, previous: string): number | null {
  return new Decimal(previous).isZero() ? null : new Decimal(current).minus(previous).div(previous).mul(100).toNumber()
}
