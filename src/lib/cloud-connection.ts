import { clearSourceSession, sourceRequest, SourceClientError } from './source-client'
import type { SourceSnapshot } from './source-client'

interface AuthStatus { cloud: true; configured: boolean; authenticated: boolean }
export type CloudConnection = { phase: 'authenticated'; snapshot: SourceSnapshot } | { phase: 'signed-out'; configured: boolean }

/** Run independent authenticated requests together; never expose a snapshot before the gate succeeds. */
export async function connectCloud(controller: AbortController): Promise<CloudConnection> {
  clearSourceSession()
  const signal = controller.signal
  const authRequest = fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin', signal })
  const snapshotRequest = sourceRequest<SourceSnapshot>('/api/ledger/snapshot', 'GET', undefined, { signal })
    .then(snapshot => ({ snapshot, error: undefined }), error => ({ snapshot: undefined, error: error as unknown }))
  try {
    const response = await authRequest
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Auth status unavailable')
    const status = await response.json() as AuthStatus
    if (signal.aborted || status.cloud !== true || typeof status.configured !== 'boolean' || typeof status.authenticated !== 'boolean') throw new Error('Invalid auth status')
    if (!status.configured || !status.authenticated) {
      controller.abort(); clearSourceSession()
      return { phase: 'signed-out', configured: status.configured }
    }
    const result = await snapshotRequest
    if (signal.aborted) throw new Error('Connection interrupted')
    if (result.error) {
      if (result.error instanceof SourceClientError && result.error.failure.code === 'UNAUTHENTICATED') {
        clearSourceSession()
        return { phase: 'signed-out', configured: true }
      }
      throw result.error
    }
    if (!result.snapshot) throw new Error('Snapshot unavailable')
    return { phase: 'authenticated', snapshot: result.snapshot }
  } catch (error) {
    if (!signal.aborted) clearSourceSession()
    controller.abort()
    throw error
  }
}
