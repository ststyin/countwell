import type { Ledger } from '../domain/types'
import type { ConnectRequest, SourceFailure, SourceStatus } from '../domain/source-types'

let sessionToken: string | null = null
let sessionGeneration = 0
export function clearSourceSession() { sessionToken = null; sessionGeneration++ }
export class SourceClientError extends Error {
  constructor(public failure: SourceFailure, public sourceStatus?: SourceStatus) { super(failure.message) }
}

export async function sourceRequest<T>(path: string, method = 'GET', data?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
  const timeout = AbortSignal.timeout(options?.timeoutMs ?? 45_000)
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  try {
    return await request<T>(path, method, data, signal)
  } catch (error) {
    if (options?.signal?.aborted) throw new SourceClientError({ message: '请求已取消。', code: 'REQUEST_CANCELLED' })
    if (timeout.aborted) throw new SourceClientError({ message: '连接超时，请检查网络后重试。', code: 'REQUEST_TIMEOUT' })
    throw error
  }
}

async function request<T>(path: string, method: string, data: unknown, signal: AbortSignal): Promise<T> {
  const generation = sessionGeneration
  const ensureCurrent = () => {
    signal.throwIfAborted()
    if (generation !== sessionGeneration) throw new SourceClientError({ message: '请求已取消。', code: 'REQUEST_CANCELLED' })
  }
  if (!sessionToken) {
    const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin', signal })
    ensureCurrent()
    if (response.status === 401) throw new SourceClientError({ message: '请先登录账本。', code: 'UNAUTHENTICATED' })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new SourceClientError({ message: '当前页面没有连接本机账本服务。请在项目中运行 npm run dev 或 npm start。', code: 'BACKEND_UNAVAILABLE' })
    const session = await response.json() as { csrf?: string }
    ensureCurrent()
    if (!session.csrf) throw new SourceClientError({ message: '账本服务版本不匹配，请重新启动。', code: 'BACKEND_UNAVAILABLE' })
    sessionToken = session.csrf
  }
  const response = await fetch(path, { method, cache: 'no-store', credentials: 'same-origin', signal, headers: { 'X-Countwell-Token': sessionToken, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined })
  const result = await response.json() as T & { error?: SourceFailure; status?: SourceStatus }
  ensureCurrent()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearSourceSession()
    if (response.status === 401) throw new SourceClientError({ message: '请先登录账本。', code: 'UNAUTHENTICATED' }, result.status)
    throw new SourceClientError(result.error ?? { message: '账本服务暂时不可用。' }, result.status)
  }
  return result
}

export type SourceSnapshot = { ledger: Ledger; status: SourceStatus }
// A remote load can spend up to two minutes fetching and another minute validating.
const loadOptions = { timeoutMs: 190_000 }
export const connectSource = (config: ConnectRequest) => sourceRequest<SourceSnapshot>('/api/ledger/connect', 'POST', config, loadOptions)
export const reloadSource = () => sourceRequest<SourceSnapshot>('/api/ledger/reload', 'POST', undefined, loadOptions)
export const disconnectSource = () => sourceRequest<SourceStatus>('/api/ledger/source', 'DELETE')
