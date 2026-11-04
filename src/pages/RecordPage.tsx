import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import type { Ledger } from '../domain/types'
import type { ExpenseDraft } from '../recording/expense'
import { isInvestmentAccount } from '../domain/reports'
import { validateExpense } from '../recording/expense'
import { accountLabels } from '../lib/accountLabels'
import { sourceRequest } from '../lib/source-client'
import { cloudMode } from '../lib/runtime'

function today() {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

type Phase = 'editing' | 'submitting' | 'pending' | 'uncertain' | 'success'
export default function RecordPage({ ledger }: { ledger: Ledger }) {
  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [payment, setPayment] = useState('')
  const [category, setCategory] = useState('')
  const [payee, setPayee] = useState('')
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<Phase>('editing')
  const [message, setMessage] = useState('')
  const draft = useRef<ExpenseDraft | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const labels = accountLabels(ledger.accounts)
  const payments = ledger.accounts.filter(a => (a.kind === 'asset' && a.role === 'cash' && !isInvestmentAccount(a.name)) || a.kind === 'liability')
  const categories = ledger.accounts.filter(a => a.kind === 'expense')
  const busy = phase === 'submitting' || phase === 'pending'

  async function send() {
    if (!cloudMode) { setMessage('请在连接 GitHub 的私有站点使用记账。'); return }
    try {
      if (!draft.current) draft.current = validateExpense({ id: crypto.randomUUID(), date, amount, currency: 'CNY', payment, category, payee, description }, ledger)
    } catch (error) { setMessage(error instanceof Error ? error.message : '请检查记账信息。'); return }
    const selected = draft.current
    const current = ++generation.current
    setMessage(''); setPhase('submitting')
    try {
      await sourceRequest('/api/expenses', 'POST', selected)
      if (current !== generation.current) return
      setPhase('pending')
      for (let i = 0; i < 36; i++) {
        await new Promise(resolve => window.setTimeout(resolve, 5000))
        if (current !== generation.current) return
        const result = await sourceRequest<{ status: 'pending' | 'success' | 'failed' }>(`/api/expenses/status?id=${encodeURIComponent(selected.id)}`)
        if (current !== generation.current) return
        if (result.status === 'success') { setPhase('success'); return }
        if (result.status === 'failed') throw new Error('提交未完成，请检查账本或重试。')
      }
      throw new Error('提交仍在处理中，请稍后重试。')
    } catch (error) {
      if (current !== generation.current) return
      setPhase('uncertain')
      setMessage(error instanceof Error ? error.message : '暂时无法确认提交结果。')
    }
  }
  function reset() { generation.current++; draft.current = null; setPhase('editing'); setMessage('') }
  function newEntry() { reset(); setAmount(''); setPayee(''); setDescription(''); setDate(today()) }
  return <section className="record-panel panel">
    {phase === 'success' ? <div className="record-success" role="status"><span className="record-success-icon"><Check size={22} /></span><h2>记账成功</h2><p>账本已提交，网站正在更新。</p><button className="button button-primary" type="button" onClick={newEntry}>再记一笔</button></div> : <form className="record-form" onSubmit={event => { event.preventDefault(); void send() }}>
      <label className="record-amount"><span>支出金额</span><div><span>¥</span><input type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label="支出金额" value={amount} onChange={event => setAmount(event.target.value)} disabled={phase !== 'editing'} required /></div></label>
      <div className="record-fields">
        <label><span>支付方式</span><select value={payment} onChange={event => setPayment(event.target.value)} disabled={phase !== 'editing'} required><option value="">选择支付方式</option>{payments.map(account => <option key={account.name} value={account.name}>{labels.get(account.name) ?? account.label}</option>)}</select></label>
        <label><span>支出分类</span><select value={category} onChange={event => setCategory(event.target.value)} disabled={phase !== 'editing'} required><option value="">选择分类</option>{categories.map(account => <option key={account.name} value={account.name}>{labels.get(account.name) ?? account.label}</option>)}</select></label>
        <label><span>日期</span><input type="date" value={date} onChange={event => setDate(event.target.value)} disabled={phase !== 'editing'} required /></label>
        <label><span>交易方式</span><input value={payee} onChange={event => setPayee(event.target.value)} maxLength={200} placeholder="例如：支付宝" disabled={phase !== 'editing'} required /></label>
        <label><span>描述</span><input value={description} onChange={event => setDescription(event.target.value)} maxLength={200} placeholder="这笔钱花在哪儿了？" disabled={phase !== 'editing'} required /></label>
      </div>
      {message && <p className="record-message" role="alert">{message}</p>}
      {phase === 'pending' && <p className="record-progress" role="status">正在校验并提交账本…</p>}
      <button className="button button-primary record-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" />{phase === 'pending' ? '正在提交' : '正在连接'}</> : phase === 'uncertain' ? '重试提交' : '保存并提交'}</button>
      {phase === 'uncertain' && <button className="button record-reset" type="button" onClick={reset}>重新填写</button>}
    </form>}
  </section>
}
