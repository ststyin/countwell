import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A small hook harness makes the in-flight state observable without a DOM.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, request: vi.fn() }))
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(harness.slots[index]) : value }]
  },
  useRef(initial: unknown) {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useCallback(fn: unknown) { harness.cursor++; return fn },
  useEffect(fn: () => void) {
    const index = harness.cursor++
    if (!(index in harness.slots)) { harness.slots[index] = true; harness.effects.push(fn) }
  },
}))
vi.mock('../src/lib/runtime', () => ({ cloudMode: true }))
vi.mock('../src/lib/source-client', () => ({
  sourceRequest: harness.request,
  connectSource: vi.fn(), disconnectSource: vi.fn(), reloadSource: vi.fn(),
  SourceClientError: class extends Error { constructor(public failure: { message: string; code?: string }) { super(failure.message) } },
}))

import { useLedgerSource } from '../src/hooks/useLedgerSource'

function render() { harness.cursor = 0; return useLedgerSource() }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.request.mockReset()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn(), dispatchEvent: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('cloud ledger startup', () => {
  it('stays loading until the authenticated snapshot arrives, without a separate status request', async () => {
    const pending = deferred<unknown>()
    harness.request.mockReturnValue(pending.promise)
    expect(render().initialLoading).toBe(true)
    harness.effects.forEach(effect => effect())
    expect(harness.request).toHaveBeenCalledTimes(1)
    expect(harness.request).toHaveBeenCalledWith('/api/ledger/snapshot')
    expect(render()).toMatchObject({ initialLoading: true, needsConnection: true })
    pending.resolve({ ledger: { title: 'private sentinel' }, status: { snapshotId: 'v1', lastError: null } })
    await vi.waitFor(() => expect(render()).toMatchObject({ initialLoading: false, needsConnection: false, real: true, backendAvailable: true }))
    expect(localStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('private sentinel'))
  })

  it('shows a genuine error only after a failed snapshot request', async () => {
    const pending = deferred<unknown>()
    harness.request.mockReturnValue(pending.promise)
    render(); harness.effects.forEach(effect => effect())
    expect(render().initialLoading).toBe(true)
    pending.reject(new Error('offline'))
    await vi.waitFor(() => expect(render()).toMatchObject({ initialLoading: false, needsConnection: true, backendAvailable: false }))
  })
})
