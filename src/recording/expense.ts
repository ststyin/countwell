import type { Ledger } from '../domain/types'

export interface ExpenseDraft {
  id: string
  date: string
  amount: string
  currency: string
  payment: string
  category: string
  description: string
}

/** Validate again in both the worker and the trusted ledger workflow. */
export function validateExpense(input: unknown, ledger: Ledger): ExpenseDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写记账信息。')
  const d = input as Record<string, unknown>
  if (typeof d.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.id)) throw new Error('请求编号无效。')
  if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('请选择有效日期。')
  const date = new Date(`${d.date}T00:00:00Z`)
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== d.date || d.date < '1900-01-01' || d.date > '9998-12-31') throw new Error('请选择有效日期。')
  if (typeof d.amount !== 'string' || !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(d.amount) || !/[1-9]/.test(d.amount)) throw new Error('请输入大于零、最多两位小数的金额。')
  if (d.currency !== 'CNY') throw new Error('暂时只支持人民币记账。')
  if (typeof d.payment !== 'string' || !ledger.accounts.some(a => a.name === d.payment && (a.kind === 'asset' || a.kind === 'liability'))) throw new Error('请选择有效的支付账户。')
  if (typeof d.category !== 'string' || !ledger.accounts.some(a => a.name === d.category && a.kind === 'expense')) throw new Error('请选择有效的支出分类。')
  if (typeof d.description !== 'string' || !d.description.trim() || d.description.length > 200 || /[\u0000-\u001f\u007f]/.test(d.description)) throw new Error('请填写不超过 200 字的描述。')
  return { id: d.id.toLowerCase(), date: d.date, amount: d.amount, currency: 'CNY', payment: d.payment, category: d.category, description: d.description.trim() }
}

export function expenseDirective(draft: ExpenseDraft): string {
  return `${draft.date} * ${JSON.stringify(draft.description)}\n  countwell_id: "${draft.id}"\n  ${draft.category}  ${draft.amount} ${draft.currency}\n  ${draft.payment}  -${draft.amount} ${draft.currency}\n`
}
