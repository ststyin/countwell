import type { Ledger } from '../domain/types'
import type { ConnectRequest, SourceFailure, SourceStatus } from '../domain/source-types'

let sessionToken: string | null = null
export class SourceClientError extends Error {
  constructor(public failure: SourceFailure, public sourceStatus?: SourceStatus) { super(failure.message) }
}

export async function sourceRequest<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  if (!sessionToken) {
    const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new SourceClientError({ message: '当前页面没有连接本机账本服务。请在项目中运行 npm run dev 或 npm start。', code: 'BACKEND_UNAVAILABLE' })
    const session = await response.json() as { csrf?: string }
    if (!session.csrf) throw new SourceClientError({ message: '账本服务版本不匹配，请重新启动。', code: 'BACKEND_UNAVAILABLE' })
    sessionToken = session.csrf
  }
  const response = await fetch(path, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Countwell-Token': sessionToken, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined })
  const result = await response.json() as T & { error?: SourceFailure; status?: SourceStatus }
  if (!response.ok) {
    if (response.status === 403) sessionToken = null
    throw new SourceClientError(result.error ?? { message: '账本服务暂时不可用。' }, result.status)
  }
  return result
}

export type SourceSnapshot = { ledger: Ledger; status: SourceStatus }
export const connectSource = (config: ConnectRequest) => sourceRequest<SourceSnapshot>('/api/ledger/connect', 'POST', config)
export const reloadSource = () => sourceRequest<SourceSnapshot>('/api/ledger/reload', 'POST')
export const disconnectSource = () => sourceRequest<SourceStatus>('/api/ledger/source', 'DELETE')
