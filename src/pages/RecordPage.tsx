import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import type { Ledger } from '../domain/types'
import type { ExpenseDraft, ExpenseStatus } from '../recording/expense'
import { isInvestmentAccount } from '../domain/reports'
import { expenseIdPattern, hasRecordedExpense, validateExpense } from '../recording/expense'
import { accountLabels } from '../lib/accountLabels'
import { sourceRequest } from '../lib/source-client'
import { cloudMode } from '../lib/runtime'

function today() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

const statusText: Record<ExpenseStatus, [string, string]> = {
  unconfirmed: ['暂未确认入账', '请查询提交状态。如果需要重试，请使用原请求编号提交同一笔支出。'],
  pending: ['正在提交', '正在校验并提交账本…'],
  failed: ['未能入账', '本次任务未完成写入。你可以用原请求编号重试。'],
  committed: ['已入账，等待网站更新', '账本已保存。网站更新完成后即可在交易中查看。'],
  publish_failed: ['已入账，网站更新失败', '账本已保存。重新发布网站后即可在交易中查看。'],
  published: ['记账成功', '网站已更新，可以在交易中查看。'],
}

function restoreRequest(key: string) {
  try {
    const id = sessionStorage.getItem(key)
    return id && expenseIdPattern.test(id) ? id : null
  } catch { return null }
}

function isWritten(status?: ExpenseStatus) {
  return status === 'committed' || status === 'publish_failed' || status === 'published'
}

export default function RecordPage({ ledger, ledgerKey = '' }: { ledger: Ledger; ledgerKey?: string }) {
  const storageKey = `countwell.pendingExpense:${ledgerKey}`
  const [requestId, setRequestId] = useState(() => cloudMode ? restoreRequest(storageKey) : null)
  const [editing, setEditing] = useState(!requestId)
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [payment, setPayment] = useState('')
  const [category, setCategory] = useState('')
  const [payee, setPayee] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ExpenseStatus>()
  const published = useMemo(() => requestId && hasRecordedExpense(ledger, requestId), [ledger, requestId])
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const operation = useRef<AbortController | null>(null)
  const draft = useRef<ExpenseDraft | null>(null)
  const labels = accountLabels(ledger.accounts)
  const payments = ledger.accounts.filter(a => (a.kind === 'asset' && a.role === 'cash' && !isInvestmentAccount(a.name)) || a.kind === 'liability')
  const categories = ledger.accounts.filter(a => a.kind === 'expense')

  const monitor = useCallback(async (id: string, expense?: ExpenseDraft, retry = false) => {
    if (operation.current) return
    const controller = new AbortController()
    const { signal } = controller
    operation.current = controller
    setMessage('')
    setChecking(true)
    const readStatus = async () => {
      const result = await sourceRequest<{ status: ExpenseStatus }>(`/api/expenses/status?id=${encodeURIComponent(id)}`, 'GET', undefined, { signal })
      setStatus(previous => isWritten(previous) && !isWritten(result.status) ? previous : result.status)
      return result.status
    }
    try {
      if (expense) {
        // An interrupted POST may already have dispatched the write.
        const current = retry ? await readStatus() : 'unconfirmed'
        if (current === 'unconfirmed' || current === 'failed') {
          try {
            await sourceRequest('/api/expenses', 'POST', expense, { signal })
          } catch (error) {
            signal.throwIfAborted()
            setMessage(error instanceof Error ? error.message : '暂时无法确认提交结果。')
          }
        }
      }
      for (let attempt = 0; attempt < 36 && !signal.aborted; attempt++) {
        const current = await readStatus()
        if (current !== 'unconfirmed') setMessage('')
        if (current === 'failed' || current === 'published' || current === 'publish_failed') return
        if (current === 'unconfirmed' && attempt >= 2) return
        await new Promise(resolve => window.setTimeout(resolve, 5000))
      }
    } catch (error) {
      if (!signal.aborted) setMessage(error instanceof Error ? error.message : '暂时无法查询提交状态。')
    } finally {
      if (operation.current === controller) {
        operation.current = null
        setChecking(false)
      }
    }
  }, [])

  useEffect(() => {
    const id = cloudMode ? restoreRequest(storageKey) : null
    if (id) void monitor(id)
    return () => {
      operation.current?.abort()
      operation.current = null
    }
  }, [storageKey, monitor])

  function send() {
    if (operation.current) return
    if (!cloudMode) { setMessage('请在连接 GitHub 的私有站点使用记账。'); return }
    let expense
    try {
      expense = validateExpense({ id: requestId ?? crypto.randomUUID(), date, amount, currency: 'CNY', payment, category, payee, description }, ledger)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请检查记账信息。')
      return
    }
    try {
      // Keep only the identifier so a refresh can recover a write whose reply was lost.
      sessionStorage.setItem(storageKey, expense.id)
    } catch {
      setMessage('无法保存提交编号，请允许站点存储后重试。')
      return
    }
    draft.current = expense
    setRequestId(expense.id)
    setEditing(false)
    void monitor(expense.id, expense, Boolean(requestId))
  }

  function newEntry() {
    try { sessionStorage.removeItem(storageKey) } catch {
      setMessage('无法清除提交编号，请允许站点存储后重试。')
      return
    }
    operation.current?.abort()
    operation.current = null
    draft.current = null
    setRequestId(null)
    setStatus(undefined)
    setChecking(false)
    setMessage('')
    setEditing(true)
    setAmount('')
    setPayee('')
    setDescription('')
    setDate(today())
  }

  if (requestId && !editing) {
    const visibleStatus = published ? 'published' : status
    const [heading, detail] = visibleStatus ? statusText[visibleStatus] : checking
      ? ['正在查询提交状态', '请稍候。']
      : ['暂未确认入账', '请再次查询提交状态。']
    return <section className="record-panel panel">
      <div className="record-success" aria-live="polite">
        <span className="record-success-icon">{isWritten(visibleStatus) ? <Check size={22} /> : <LoaderCircle size={22} className={checking ? 'spin' : ''} />}</span>
        <h2>{heading}</h2>
        <p>{detail}</p>
        {message && visibleStatus !== 'published' && <p className="record-message" role="alert">{message}</p>}
        {isWritten(visibleStatus) && <button className="button button-primary" type="button" onClick={newEntry}>再记一笔</button>}
        {!checking && visibleStatus !== 'published' && <button className="button" type="button" onClick={() => void monitor(requestId)}>查询提交状态</button>}
        {!checking && (visibleStatus === 'failed' || visibleStatus === 'unconfirmed') && <button className="button" type="button" onClick={() => {
          if (draft.current) void monitor(requestId, draft.current, true)
          else { setMessage(''); setEditing(true) }
        }}>{draft.current ? '重试同一笔支出' : '重新填写同一笔支出'}</button>}
      </div>
    </section>
  }

  return <section className="record-panel panel">
    <form className="record-form" onSubmit={event => { event.preventDefault(); send() }}>
      {requestId && <p className="record-progress">请填写原来那笔支出。系统会用原提交编号查询和重试。</p>}
      <label className="record-amount"><span>支出金额</span><div><span>¥</span><input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label="支出金额" value={amount} onChange={event => setAmount(event.target.value)} required /></div></label>
      <div className="record-fields">
        <label><span>支付方式</span><span className="field-frame"><select value={payment} onChange={event => setPayment(event.target.value)} required><option value="">选择支付方式</option>{payments.map(account => <option key={account.name} value={account.name}>{labels.get(account.name) ?? account.label}</option>)}</select></span></label>
        <label><span>支出分类</span><span className="field-frame"><select value={category} onChange={event => setCategory(event.target.value)} required><option value="">选择分类</option>{categories.map(account => <option key={account.name} value={account.name}>{labels.get(account.name) ?? account.label}</option>)}</select></span></label>
        <label><span>日期</span><span className="field-frame"><input type="date" value={date} onChange={event => setDate(event.target.value)} required /></span></label>
        <label><span>交易方式</span><span className="field-frame"><input value={payee} onChange={event => setPayee(event.target.value)} maxLength={200} placeholder="例如：支付宝" required /></span></label>
        <label><span>描述</span><span className="field-frame"><input value={description} onChange={event => setDescription(event.target.value)} maxLength={200} placeholder="这笔钱花在哪儿了？" required /></span></label>
      </div>
      {message && <p className="record-message" role="alert">{message}</p>}
      <button className="button button-primary record-submit" type="submit">{requestId ? '重试同一笔支出' : '保存并提交'}</button>
      {requestId && <button className="button" type="button" onClick={() => {
        setEditing(false)
        void monitor(requestId)
      }}>返回提交状态</button>}
    </form>
  </section>
}
