import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceSnapshot } from '../src/lib/source-client'

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void>, connect: vi.fn(), clear: vi.fn(), listeners: new Map<string, () => void>() }))
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = value }]
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
vi.mock('../src/lib/cloud-connection', () => ({ connectCloud: harness.connect }))
vi.mock('../src/lib/source-client', () => ({ clearSourceSession: harness.clear }))
vi.mock('../src/hooks/usePwa', () => ({ usePwa: () => ({ ios: false, isStandalone: false }) }))
vi.mock('../src/hooks/useStartupNavigation', () => ({ useStartupNavigation: () => true }))

import CloudGate from '../src/components/CloudGate'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function render(child: (snapshot: SourceSnapshot) => string) { harness.cursor = 0; return CloudGate({ children: child }) }

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.connect.mockReset(); harness.clear.mockReset(); harness.listeners.clear()
  vi.stubGlobal('window', { location: { href: 'https://ledger.example/' }, history: { replaceState: vi.fn(), state: null }, setTimeout, clearTimeout,
    addEventListener: (name: string, fn: () => void) => harness.listeners.set(name, fn), removeEventListener: (name: string) => harness.listeners.delete(name) })
  vi.stubGlobal('document', { title: '' })
})
afterEach(() => vi.unstubAllGlobals())

describe('private connection screen transitions', () => {
  it('keeps children hidden until the complete connection is ready, and hides them again on session expiry', async () => {
    const first = deferred<unknown>(), next = deferred<unknown>()
    harness.connect.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
    const child = vi.fn(() => 'private page')
    expect(render(child)).not.toBe('private page')
    harness.effects.forEach(effect => effect())
    expect(render(child)).not.toBe('private page')
    expect(child).not.toHaveBeenCalled()
    const snapshot = { ledger: { title: 'private sentinel' }, status: { snapshotId: 'v1' } }
    first.resolve({ phase: 'authenticated', snapshot })
    await vi.waitFor(() => expect(render(child)).toBe('private page'))
    expect(child).toHaveBeenCalledWith(snapshot, true)
    harness.listeners.get('countwell:session-expired')?.()
    expect(render(child)).not.toBe('private page')
    next.resolve({ phase: 'signed-out', configured: true })
    await vi.waitFor(() => expect(JSON.stringify(render(child))).toContain('GitHub 登录'))
  })

  it('shows a retryable connection failure without rendering private children', async () => {
    const pending = deferred<unknown>(), child = vi.fn(() => 'private page')
    harness.connect.mockReturnValue(pending.promise)
    render(child); harness.effects.forEach(effect => effect())
    pending.reject(new Error('offline'))
    await vi.waitFor(() => expect(JSON.stringify(render(child))).toContain('重新连接'))
    expect(child).not.toHaveBeenCalled()
    expect(harness.clear).toHaveBeenCalled()
  })
})
