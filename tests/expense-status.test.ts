import { describe, expect, it } from 'vitest'
import { expenseStatus } from '../cloud/record-expense'
import type { SourceSnapshot } from '../src/lib/source-client'

const id = '00000000-0000-4000-8000-000000000001'
const snapshot: SourceSnapshot = {
  ledger: { title: 'Test', source: '', defaultMonth: '2026-11', accounts: [], accountNames: [], prices: [], commodities: [], transactions: [] },
  status: { configured: true, connected: true, loading: false, allowPlugins: false, loadedAt: null, source: { type: 'github', repository: 'owner/ledger', entryPath: 'main.beancount' }, snapshotId: 'test', fileCount: 1, transactionCount: 0, lastError: null },
}
const repo = 'https://api.github.com/repos/owner/ledger'
const run = { id: 42, display_title: 'Countwell expense ' + id, head_branch: 'main', status: 'completed', conclusion: 'failure' }
const commit = (conclusion: string) => ({ name: 'Commit validated expense', conclusion })
const update = (conclusion: string) => ({ name: 'Start private site update', conclusion })

function query(routes: Record<string, unknown>) {
  const fetcher: typeof fetch = async url => {
    if (String(url) === repo) return Response.json({ private: true, full_name: 'owner/ledger', default_branch: 'main', owner: { id: 1, type: 'User' } })
    const path = String(url).split('?')[0].slice(repo.length)
    if (path in routes) return Response.json(routes[path])
    throw new Error('Unexpected GitHub URL: ' + path)
  }
  return expenseStatus(id, snapshot, '1', 'test-token', fetcher)
}

describe('expense status', () => {
  it.each([
    ['publish_failed', [commit('success'), update('failure')]],
    ['unconfirmed', [commit('failure'), update('skipped')]],
    ['failed', [commit('skipped'), update('skipped')]],
  ] as const)('returns %s based on what happened before workflow failure', async (status, steps) => {
    await expect(query({
      '/actions/workflows/countwell-record.yml/runs': { workflow_runs: [run] },
      '/actions/runs/42/jobs': { jobs: [{ steps }] },
    })).resolves.toEqual({ status })
  })

  it('uses a successful write even if the newest retry was canceled and checks the related publication', async () => {
    const routes = {
      '/actions/workflows/countwell-record.yml/runs': { workflow_runs: [{ ...run, id: 43, conclusion: 'cancelled' }, run] },
      '/actions/runs/43/jobs': { jobs: [] },
      '/actions/runs/42/jobs': { jobs: [{ steps: [commit('success'), update('success')] }] },
    }
    const publication = { ...run, display_title: 'Countwell publish expense ' + id }
    for (const [conclusion, status] of [['success', 'committed'], ['failure', 'publish_failed']]) {
      await expect(query({
        ...routes,
        '/actions/workflows/countwell-sync.yml/runs': { workflow_runs: [{ ...publication, conclusion }] },
      })).resolves.toEqual({ status })
    }
  })

  it('recognizes a published expense even after GitHub run history is gone', async () => {
    const published = {
      ...snapshot,
      ledger: { ...snapshot.ledger, files: [{ path: 'transactions/2026/11.beancount', content: `2026-11-06 * "Lunch"\n  countwell_id: "${id}"\n` }] },
    }
    const unexpectedFetch = async () => { throw new Error('Published expense should not need Actions history') }
    await expect(expenseStatus(id, published, '1', undefined, unexpectedFetch)).resolves.toEqual({ status: 'published' })
  })
})
