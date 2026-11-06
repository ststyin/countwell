import type { SourceSnapshot } from '../src/lib/source-client'
import { expenseIdPattern, hasRecordedExpense, validateExpense } from '../src/recording/expense'
import type { ExpenseStatus } from '../src/recording/expense'

const workflow = 'countwell-record.yml'
const jsonHeaders = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Countwell' }
export class RecordingError extends Error { constructor(message: string, public status = 400) { super(message) } }

async function github(fetcher: typeof fetch, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetcher(`https://api.github.com${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { ...jsonHeaders, Authorization: `Bearer ${token}`, ...init.headers } })
  if (response.redirected || response.status >= 300 && response.status < 400) throw new RecordingError('GitHub 仓库已更改，请检查配置。', 503)
  return response
}

async function target(snapshot: SourceSnapshot, uid: string, token: string, fetcher: typeof fetch) {
  const source = snapshot.status.source
  if (!source || source.type !== 'github' || source.entryPath !== 'main.beancount' || !source.repository || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(source.repository)) throw new RecordingError('当前账本不支持网页记账。', 503)
  const path = `/repos/${source.repository}`
  const response = await github(fetcher, token, path)
  if (!response.ok) throw new RecordingError('GitHub 记账授权不可用，请检查配置。', 503)
  const meta = await response.json() as { private?: unknown; full_name?: unknown; default_branch?: unknown; owner?: { id?: unknown; type?: unknown } }
  if (meta.private !== true || typeof meta.full_name !== 'string' || meta.full_name.toLowerCase() !== source.repository.toLowerCase() || String(meta.owner?.id) !== uid || meta.owner?.type !== 'User' || typeof meta.default_branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(meta.default_branch)) throw new RecordingError('账本仓库或所有者不匹配。', 403)
  return { path, branch: meta.default_branch }
}

export async function startExpense(request: Request, snapshot: SourceSnapshot, uid: string, token: string | undefined, fetcher: typeof fetch): Promise<{ id: string }> {
  if (!token || token.length > 4096) throw new RecordingError('记账功能尚未配置 GitHub 授权。', 503)
  if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new RecordingError('记账内容过长。', 413)
  const body = await request.text()
  if (body.length > 4096) throw new RecordingError('记账内容过长。', 413)
  let input: unknown
  try { input = JSON.parse(body) } catch { throw new RecordingError('记账内容格式无效。') }
  let draft
  try { draft = validateExpense(input, snapshot.ledger) } catch (error) { throw new RecordingError(error instanceof Error ? error.message : '记账信息无效。') }
  const { path, branch } = await target(snapshot, uid, token, fetcher)
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(draft))))
  const response = await github(fetcher, token, `${path}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: branch, inputs: { request_id: draft.id, payload } }) })
  if (!response.ok) throw new RecordingError('提交请求未能确认，请稍后重试。', 503)
  return { id: draft.id }
}

type WorkflowRun = { id: number; display_title: string; head_branch: string; status: string; conclusion: string | null }
type JobStep = { name: string; conclusion: string | null }

async function findRuns(fetcher: typeof fetch, token: string, path: string, workflowName: string, branch: string, title: string) {
  const query = new URLSearchParams({ branch, event: 'workflow_dispatch', per_page: '100' })
  const response = await github(fetcher, token, `${path}/actions/workflows/${workflowName}/runs?${query}`)
  if (!response.ok) throw new RecordingError('暂时无法查询提交状态。', 503)
  const body = await response.json() as { workflow_runs: WorkflowRun[] }
  return body.workflow_runs.filter(run => run.display_title === title && run.head_branch === branch)
}

export async function expenseStatus(id: string, snapshot: SourceSnapshot, uid: string, token: string | undefined, fetcher: typeof fetch): Promise<{ status: ExpenseStatus }> {
  if (!expenseIdPattern.test(id)) throw new RecordingError('请求编号无效。')
  id = id.toLowerCase()
  if (hasRecordedExpense(snapshot.ledger, id)) return { status: 'published' }
  if (!token || token.length > 4096) throw new RecordingError('记账功能尚未配置 GitHub 授权。', 503)
  const { path, branch } = await target(snapshot, uid, token, fetcher)
  const runs = await findRuns(fetcher, token, path, workflow, branch, `Countwell expense ${id}`)
  if (!runs.length) return { status: 'unconfirmed' }

  // The same ID may have been dispatched more than once after a network error.
  // A canceled retry must not hide a successful write from an earlier run.
  let writeUnconfirmed = false
  let committed = false
  let updateStarted = false
  for (const run of runs) {
    if (!Number.isSafeInteger(run.id) || run.id <= 0) throw new RecordingError('暂时无法查询提交状态。', 503)
    if (run.status !== 'completed') continue
    const response = await github(fetcher, token, `${path}/actions/runs/${run.id}/jobs?filter=all&per_page=100`)
    if (!response.ok) throw new RecordingError('暂时无法查询提交状态。', 503)
    const body = await response.json() as { jobs: { steps?: JobStep[] }[] }
    for (const { steps = [] } of body.jobs) {
      const write = steps.find(step => step.name === 'Commit validated expense')
      if (write?.conclusion === 'success') {
        committed = true
        updateStarted ||= steps.some(step => step.name === 'Start private site update' && step.conclusion === 'success')
      } else if (write && write.conclusion !== 'skipped') {
        // A push can reach GitHub before the runner loses the connection.
        writeUnconfirmed = true
      }
    }
  }

  const pending = runs.some(run => run.status !== 'completed')
  if (committed) {
    if (!updateStarted) return { status: pending ? 'committed' : 'publish_failed' }
    const updates = await findRuns(fetcher, token, path, 'countwell-sync.yml', branch, `Countwell publish expense ${id}`)
    // A successful build may have skipped deployment because a newer ledger
    // exists. Only the marker in the served snapshot confirms publication.
    if (updates[0]?.status === 'completed' && updates[0].conclusion !== 'success' && !pending) return { status: 'publish_failed' }
    return { status: 'committed' }
  }
  if (pending) return { status: 'pending' }
  return { status: writeUnconfirmed ? 'unconfirmed' : 'failed' }
}
