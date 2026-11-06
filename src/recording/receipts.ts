import { expenseIdPattern, expenseStatuses, isExpenseWritten } from './expense'
import type { ExpenseStatus } from './expense'

export interface ExpenseReceipt {
  id: string
  submittedAt: number
  state?: ExpenseStatus
}

export const recentReceiptLimit = 20

function prefix(ledgerKey: string) {
  return `countwell.expenseReceipt:${encodeURIComponent(ledgerKey)}:`
}

function readReceipt(key: string, id: string): ExpenseReceipt | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw || !expenseIdPattern.test(id)) return null
    const { submittedAt, state } = JSON.parse(raw)
    if (!Number.isFinite(submittedAt) || submittedAt < 0 || submittedAt > 8.64e15) return null
    return { id, submittedAt, state: expenseStatuses.includes(state) ? state : undefined }
  } catch { return null }
}

function list(ledgerKey: string) {
  const start = prefix(ledgerKey)
  return Object.keys(localStorage).flatMap(key => {
    if (!key.startsWith(start)) return []
    const receipt = readReceipt(key, key.slice(start.length))
    return receipt ? [receipt] : []
  }).sort((a, b) => b.submittedAt - a.submittedAt)
}

export function recentExpenseReceipts(ledgerKey: string): ExpenseReceipt[] {
  try { return list(ledgerKey).slice(0, recentReceiptLimit) } catch { return [] }
}

export function rememberExpenseReceipt(ledgerKey: string, id: string, observed?: ExpenseStatus): ExpenseReceipt[] | null {
  try {
    const start = prefix(ledgerKey)
    const key = start + id
    const previous = readReceipt(key, id)
    const state = observed && (!isExpenseWritten(previous?.state) || isExpenseWritten(observed))
      ? observed : previous?.state
    if (previous && previous.state === state) return null
    localStorage.setItem(key, JSON.stringify({ submittedAt: previous?.submittedAt ?? Date.now(), state }))
    const receipts = list(ledgerKey)
    for (const receipt of receipts.slice(recentReceiptLimit)) localStorage.removeItem(start + receipt.id)
    return receipts.slice(0, recentReceiptLimit)
  } catch {
    // The active request can still be recovered from session storage.
    return null
  }
}
