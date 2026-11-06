import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectCloud } from '../src/lib/cloud-connection'
import { clearSourceSession, sourceRequest } from '../src/lib/source-client'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const auth = (authenticated = true) => json({ cloud: true, configured: true, authenticated })
const snapshot = { ledger: { title: 'private sentinel' }, status: { snapshotId: 'snapshot-1' } }

beforeEach(() => { clearSourceSession() })
afterEach(() => { clearSourceSession(); vi.unstubAllGlobals() })

describe('parallel private ledger connection', () => {
  it('starts loading the snapshot before auth completes, but waits for both before exposing it', async () => {
    const pendingAuth = deferred<Response>(), pendingSnapshot = deferred<Response>()
    const fetcher = vi.fn((url: string) => url === '/api/auth/status' ? pendingAuth.promise : url === '/api/session' ? Promise.resolve(json({ csrf: 'token' })) : pendingSnapshot.promise)
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    let completed = false
    const result = connectCloud(controller).then(value => { completed = true; return value })
    expect(fetcher).toHaveBeenCalledWith('/api/auth/status', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin', signal: controller.signal }))
    expect(fetcher).toHaveBeenCalledWith('/api/session', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin', signal: expect.any(AbortSignal) }))
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/ledger/snapshot', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin', signal: expect.any(AbortSignal) })))
    pendingSnapshot.resolve(json(snapshot))
    await Promise.resolve(); await Promise.resolve()
    expect(completed).toBe(false)
    pendingAuth.resolve(auth())
    expect(await result).toEqual({ phase: 'authenticated', snapshot })
  })

  it('discards even a completed snapshot if authentication is denied', async () => {
    const pendingAuth = deferred<Response>()
    const fetcher = vi.fn((url: string) => url === '/api/auth/status' ? pendingAuth.promise : Promise.resolve(url === '/api/session' ? json({ csrf: 'token' }) : json(snapshot)))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const pending = connectCloud(controller)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/ledger/snapshot', expect.anything()))
    pendingAuth.resolve(auth(false))
    const result = await pending
    expect(result).toEqual({ phase: 'signed-out', configured: true })
    expect(JSON.stringify(result)).not.toContain('private sentinel')
    expect(controller.signal.aborted).toBe(true)
  })

  it('handles an expired session even when the initial identity check succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url === '/api/auth/status' ? auth() : json({ error: { code: 'UNAUTHENTICATED' } }, 401))))
    expect(await connectCloud(new AbortController())).toEqual({ phase: 'signed-out', configured: true })
  })

  it('reports snapshot failure and starts a fresh session on retry', async () => {
    let failed = true
    const fetcher = vi.fn((url: string) => Promise.resolve(url === '/api/auth/status' ? auth() : url === '/api/session' ? json({ csrf: 'token' }) : failed ? json({ error: { message: 'offline' } }, 503) : json(snapshot)))
    vi.stubGlobal('fetch', fetcher)
    await expect(connectCloud(new AbortController())).rejects.toThrow('offline')
    failed = false
    expect(await connectCloud(new AbortController())).toEqual({ phase: 'authenticated', snapshot })
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(2)
  })

  it('does not allow an aborted older attempt to invalidate the new session', async () => {
    const oldAuth = deferred<Response>(), oldSession = deferred<Response>()
    let authCalls = 0, sessionCalls = 0
    const fetcher = vi.fn((url: string) => {
      if (url === '/api/auth/status') return ++authCalls === 1 ? oldAuth.promise : Promise.resolve(auth())
      if (url === '/api/session') return ++sessionCalls === 1 ? oldSession.promise : Promise.resolve(json({ csrf: 'new-token' }))
      return Promise.resolve(url === '/api/ledger/snapshot' ? json(snapshot) : json({ connected: true }))
    })
    vi.stubGlobal('fetch', fetcher)
    const oldController = new AbortController()
    const old = connectCloud(oldController).catch(() => null)
    oldController.abort()
    expect(await connectCloud(new AbortController())).toEqual({ phase: 'authenticated', snapshot })
    oldAuth.resolve(auth()); oldSession.resolve(json({ csrf: 'old-token' }))
    await old
    expect(await sourceRequest('/api/ledger/status')).toEqual({ connected: true })
    expect(sessionCalls).toBe(2)
    expect(fetcher).toHaveBeenLastCalledWith('/api/ledger/status', expect.objectContaining({ headers: { 'X-Countwell-Token': 'new-token' } }))
  })
})
