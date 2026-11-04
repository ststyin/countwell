import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOfficialLedger } from '../server/engine'
import { recordExpense } from '../scripts/record-expense'
import { createRecordExpenseWorkflow } from '../scripts/record-expense-workflow'
import { validateExpense } from '../src/recording/expense'
import { startExpense, expenseStatus } from '../cloud/record-expense'
import type { SourceSnapshot } from '../src/lib/source-client'

const id = '11111111-1111-4111-8111-111111111111'
const draft = { id, date: '2026-11-05', amount: '23.40', currency: 'CNY', payment: 'Assets:Bank', category: 'Expenses:Food', payee: '支付宝', description: '午餐 "米饭"' }
const base = `2026-01-01 open Assets:Bank CNY\n2026-01-01 open Expenses:Food CNY\n2026-01-01 open Equity:Opening CNY\n2026-01-02 * "Opening"\n  Assets:Bank 100 CNY\n  Equity:Opening -100 CNY\n`
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })
async function fixture(extra = '') { root = await mkdtemp(join(tmpdir(), 'countwell-record-')); await writeFile(join(root, 'main.beancount'), base + extra); return root }

describe('validated GitHub expense recording', () => {
  it('creates a monthly file, includes it once, balances the postings and does not duplicate retries', async () => {
    await fixture()
    expect(await recordExpense(root, 'main.beancount', draft)).toEqual({ created: true, file: 'transactions/2026/11.beancount' })
    const ledger = await loadOfficialLedger(join(root, 'main.beancount'), { sourceRoot: root })
    const tx = ledger.transactions.find(row => row.date === draft.date)!
    expect(tx.payee).toBe(draft.payee)
    expect(tx.narration).toBe(draft.description)
    expect(tx.postings.map(posting => [posting.account, posting.amount, posting.currency])).toEqual([['Expenses:Food', '23.40', 'CNY'], ['Assets:Bank', '-23.40', 'CNY']])
    expect(await recordExpense(root, 'main.beancount', draft)).toEqual({ created: false, file: '' })
    expect((await readFile(join(root, 'main.beancount'), 'utf8')).match(/include "transactions\/2026\/11.beancount"/g)).toHaveLength(1)
    expect((await readFile(join(root, 'transactions/2026/11.beancount'), 'utf8')).match(/countwell_id/g)).toHaveLength(1)
  })
  it('accepts previously queued requests without a payee', async () => {
    await fixture()
    const { payee: _payee, ...previousDraft } = draft
    await recordExpense(root, 'main.beancount', previousDraft)
    const ledger = await loadOfficialLedger(join(root, 'main.beancount'), { sourceRoot: root })
    expect(ledger.transactions.find(row => row.date === draft.date)?.narration).toBe(draft.description)
  })
  it('respects existing wildcard includes without adding a duplicate include', async () => {
    await fixture('include "transactions/2026/*.beancount"\n')
    await mkdir(join(root, 'transactions/2026'), { recursive: true })
    await writeFile(join(root, 'transactions/2026/10.beancount'), '; previous month\n')
    await recordExpense(root, 'main.beancount', draft)
    expect(await readFile(join(root, 'main.beancount'), 'utf8')).not.toContain('include "transactions/2026/11.beancount"')
    expect((await loadOfficialLedger(join(root, 'main.beancount'), { sourceRoot: root })).transactions.some(row => row.narration === draft.description)).toBe(true)
  })
  it('rejects a candidate which breaks an existing balance assertion', async () => {
    await fixture('2026-11-30 balance Assets:Bank 100 CNY\n')
    await expect(recordExpense(root, 'main.beancount', draft)).rejects.toThrow()
  })
  it('rejects malformed input, unavailable accounts and unsupported currencies', async () => {
    await fixture()
    const ledger = await loadOfficialLedger(join(root, 'main.beancount'), { sourceRoot: root })
    for (const change of [{ amount: '0' }, { amount: '1\n2026-01-01' }, { amount: '2.345' }, { date: '2026-02-30' }, { description: 'a\nb' }, { payee: 'a\nb' }, { category: 'Assets:Bank' }, { payment: 'Assets:Missing' }, { currency: 'USD' }]) {
      expect(() => validateExpense({ ...draft, ...change }, ledger)).toThrow()
    }
  })
  it('checks the candidate before the commit and explicitly triggers the existing sync workflow', () => {
    const workflow = createRecordExpenseWorkflow()
    expect(workflow.indexOf('Prepare and validate expense')).toBeLessThan(workflow.indexOf('Commit validated expense'))
    expect(workflow).toContain('countwell-sync.yml')
    expect(workflow).toContain('cancel-in-progress: false')
  })
  it('dispatches only to the authenticated owner’s private repository and can track its run', async () => {
    await fixture()
    const ledger = await loadOfficialLedger(join(root, 'main.beancount'), { sourceRoot: root })
    const snapshot = { ledger, status: { source: { type: 'github', repository: 'fixture/books', entryPath: 'main.beancount' } } } as SourceSnapshot
    const calls: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); calls.push(url)
      if (url.endsWith('/repos/fixture/books')) return Response.json({ private: true, full_name: 'fixture/books', default_branch: 'main', owner: { id: 42, type: 'User' } })
      if (url.endsWith('/dispatches')) { const sent = JSON.parse(String(init?.body)); expect(sent.ref).toBe('main'); expect(JSON.parse(Buffer.from(sent.inputs.payload, 'base64').toString('utf8'))).toEqual(draft); return new Response(null, { status: 204 }) }
      if (url.includes('/runs?')) return Response.json({ workflow_runs: [{ display_title: `Countwell expense ${id}`, head_branch: 'main', status: 'completed', conclusion: 'success' }] })
      throw new Error('Unexpected endpoint')
    }
    const request = new Request('https://ledger.example/api/expenses', { method: 'POST', body: JSON.stringify(draft) })
    expect(await startExpense(request, snapshot, '42', 'fixture-token', fetcher)).toEqual({ id })
    expect(await expenseStatus(id, snapshot, '42', 'fixture-token', fetcher)).toEqual({ status: 'success' })
    expect(calls).toHaveLength(4)
    await expect(expenseStatus(id, snapshot, '999', 'fixture-token', fetcher)).rejects.toMatchObject({ status: 403 })
  })
})
