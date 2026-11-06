import { afterEach, expect, it, vi } from 'vitest'
import { clearSourceSession, sourceRequest } from '../src/lib/source-client'

afterEach(() => { vi.unstubAllGlobals(); clearSourceSession() })

it('times out a stalled request and allows the next check to succeed', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ csrf: 'fixture' }))
    .mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    .mockResolvedValueOnce(Response.json({ connected: true }))
  vi.stubGlobal('fetch', fetcher)
  await expect(sourceRequest('/api/ledger/status', 'GET', undefined, { timeoutMs: 30 }))
    .rejects.toMatchObject({ failure: { code: 'REQUEST_TIMEOUT' } })
  await expect(sourceRequest('/api/ledger/status')).resolves.toEqual({ connected: true })
})
