import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Coffee, ShoppingBag, Home, Car, Heart, Film, BriefcaseBusiness, Wallet, UtensilsCrossed, BookOpen, ChevronRight, SearchX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { currencySymbols, formatAmount } from '../lib/format'

export const DisplayContext = createContext({ hidden: false, currency: 'CNY' })

export function Money({ amount, currency, className = '', symbol = false, signed = false }: { amount: string | null; currency?: string; className?: string; symbol?: boolean; signed?: boolean }) {
  const display = useContext(DisplayContext)
  const unit = currency ?? display.currency
  const value = amount === null ? '—' : `${signed && !amount.startsWith('-') && amount !== '0' ? '+' : ''}${formatAmount(amount)}`
  return <span className={`money ${className}`} aria-label={display.hidden ? '金额已隐藏' : undefined}>{display.hidden ? '••••' : <>{symbol && amount !== null && <span className="currency-symbol">{currencySymbols[unit] ?? unit + ' '}</span>}{value}</>}</span>
}

export function CategoryIcon({ name, kind, size = 18 }: { name: string; kind?: string; size?: number }) {
  let Icon: LucideIcon = ShoppingBag
  if (/餐|吃|食/.test(name)) Icon = UtensilsCrossed
  else if (/咖啡|饮/.test(name)) Icon = Coffee
  else if (/住房|房租|租|家/.test(name)) Icon = Home
  else if (/交通|车|出行/.test(name)) Icon = Car
  else if (/医疗|健康|保健/.test(name)) Icon = Heart
  else if (/娱乐|电影|订阅/.test(name)) Icon = Film
  else if (/工资|薪|收入/.test(name)) Icon = BriefcaseBusiness
  else if (/书|学|教育/.test(name)) Icon = BookOpen
  else if (kind === 'transfer') Icon = ArrowLeftRight
  else if (kind === 'income') Icon = ArrowDownLeft
  else if (kind === 'refund') Icon = ArrowUpRight
  else if (kind === 'investment') Icon = Wallet
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />
}

export function SectionTitle({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <button className="text-action" onClick={onAction}>{action}<ChevronRight size={15} /></button>}</div>
}

export function EmptyState({ title = '这个月，还没有记录', description = '试试切换月份，看看其他时候的生活。', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><SearchX size={25} strokeWidth={1.5} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}
