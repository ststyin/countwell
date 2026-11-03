import { renderToStaticMarkup } from 'react-dom/server'
import { Children, isValidElement } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingCycleSettings from '../src/components/BillingCycleSettings'

const key = 'countwell.billingCycle'

function browserFixture(options: { saved?: string; blocked?: boolean } = {}) {
  const values = new Map<string, string>()
  if (options.saved !== undefined) values.set(key, options.saved)
  const storageListeners = new Set<(event: { key: string | null }) => void>()
  const addEventListener = vi.fn((_event: string, callback: (event: { key: string | null }) => void) => storageListeners.add(callback))
  const removeEventListener = vi.fn((_event: string, callback: (event: { key: string | null }) => void) => storageListeners.delete(callback))
  vi.stubGlobal('window', {
    addEventListener, removeEventListener,
    localStorage: {
      getItem(name: string) { if (options.blocked) throw new Error('Storage unavailable'); return values.get(name) ?? null },
      setItem(name: string, value: string) { if (options.blocked) throw new Error('Storage unavailable'); values.set(name, value) },
    },
  })
  return { values, storageListeners, addEventListener,
    changed(name: string | null = key) { storageListeners.forEach(listener => listener({ key: name })) },
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('billing-cycle preference', () => {
  it('defaults to calendar months for missing, malformed, unsafe, or unavailable saved preferences', async () => {
    for (const saved of [undefined, 'not json', '{}', '[]',
      '{"mode":"custom","day":0,"boundary":"start"}',
      '{"mode":"custom","day":32,"boundary":"start"}',
      '{"mode":"custom","day":2.5,"boundary":"start"}',
      '{"mode":"custom","day":"25","boundary":"start"}',
      '{"mode":"custom","day":25,"boundary":"unknown"}',
    ]) {
      vi.resetModules()
      browserFixture({ saved })
      const preference = await import('../src/hooks/useBillingCycle')
      expect(preference.getBillingCycle()).toEqual({ mode: 'calendar', day: 1, boundary: 'start' })
    }
    vi.resetModules()
    browserFixture({ blocked: true })
    const preference = await import('../src/hooks/useBillingCycle')
    expect(preference.getBillingCycle().mode).toBe('calendar')
  })

  it('stores a start day or calendar months and strips unrelated information', async () => {
    const browser = browserFixture()
    const preference = await import('../src/hooks/useBillingCycle')
    preference.setBillingCycle({ mode: 'custom', day: 25, boundary: 'start', unexpected: 'private sentinel' } as Parameters<typeof preference.setBillingCycle>[0])
    expect(JSON.parse(browser.values.get(key)!)).toEqual({ mode: 'custom', day: 25, boundary: 'start' })
    expect(browser.values.get(key)).not.toContain('sentinel')
    vi.resetModules()
    const restored = await import('../src/hooks/useBillingCycle')
    expect(restored.getBillingCycle()).toEqual({ mode: 'custom', day: 25, boundary: 'start' })
    restored.setBillingCycle({ mode: 'custom', day: 1, boundary: 'start' })
    expect(restored.getBillingCycle()).toEqual({ mode: 'calendar', day: 1, boundary: 'start' })
  })

  it('converts old end-day and independent-range preferences to a start day', async () => {
    for (const [saved, expected] of [
      [{ mode: 'custom', day: 25, boundary: 'end' }, { mode: 'custom', day: 26, boundary: 'start' }],
      [{ mode: 'custom', day: 31, boundary: 'end' }, { mode: 'calendar', day: 1, boundary: 'start' }],
      [{ mode: 'range', day: 1, boundary: 'start', startDay: 20, endDay: 25 }, { mode: 'custom', day: 20, boundary: 'start' }],
    ] as const) {
      vi.resetModules()
      browserFixture({ saved: JSON.stringify(saved) })
      const preference = await import('../src/hooks/useBillingCycle')
      expect(preference.getBillingCycle()).toEqual(expected)
    }
  })

  it('shares updates between active views and tabs and cleans up the storage listener', async () => {
    const browser = browserFixture()
    const preference = await import('../src/hooks/useBillingCycle')
    const firstListener = vi.fn(), secondListener = vi.fn()
    const first = preference.subscribeBillingCycle(firstListener)
    const second = preference.subscribeBillingCycle(secondListener)
    expect(browser.addEventListener).toHaveBeenCalledTimes(1)
    preference.setBillingCycle({ mode: 'custom', day: 31, boundary: 'start' })
    expect(firstListener).toHaveBeenCalledTimes(1)
    expect(secondListener).toHaveBeenCalledTimes(1)
    preference.setBillingCycle({ mode: 'custom', day: 31, boundary: 'start' })
    expect(firstListener).toHaveBeenCalledTimes(1)
    browser.values.set(key, JSON.stringify({ mode: 'custom', day: 10, boundary: 'start' }))
    browser.changed('other.preference')
    expect(preference.getBillingCycle().day).toBe(31)
    browser.changed()
    expect(preference.getBillingCycle().day).toBe(10)
    browser.values.set(key, '{')
    browser.changed()
    expect(preference.getBillingCycle().mode).toBe('calendar')
    browser.values.clear()
    browser.changed(null)
    expect(preference.getBillingCycle().mode).toBe('calendar')
    first()
    expect(browser.storageListeners.size).toBe(1)
    second()
    expect(browser.storageListeners.size).toBe(0)
  })

  it('keeps a valid choice for this session when storage is blocked and ignores invalid changes', async () => {
    browserFixture({ blocked: true })
    const preference = await import('../src/hooks/useBillingCycle')
    preference.setBillingCycle({ mode: 'custom', day: 25, boundary: 'start' })
    const stop = preference.subscribeBillingCycle(vi.fn())
    expect(preference.getBillingCycle()).toEqual({ mode: 'custom', day: 25, boundary: 'start' })
    stop()
    const current = preference.getBillingCycle()
    preference.setBillingCycle({ mode: 'custom', day: 99, boundary: 'end' })
    expect(preference.getBillingCycle()).toBe(current)
    preference.setBillingCycle({ mode: 'calendar', day: 25, boundary: 'end' })
    expect(preference.getBillingCycle()).toEqual({ mode: 'calendar', day: 1, boundary: 'start' })
  })

  it('shows one start-day control with a calendar-month default and an accurate preview', () => {
    const calendar = renderToStaticMarkup(<BillingCycleSettings month="2026-11" cycle={{ mode: 'calendar', day: 1, boundary: 'start' }} onChange={() => {}} />)
    expect(calendar.match(/<select\b/g)).toHaveLength(1)
    expect(calendar).toContain('1 日（自然月）')
    expect(calendar).toContain('2026-11-01')
    expect(calendar).toContain('2026-11-30')
    const start = renderToStaticMarkup(<BillingCycleSettings month="2026-11" cycle={{ mode: 'custom', day: 25, boundary: 'start' }} onChange={() => {}} />)
    expect(start).toContain('2026-10-25')
    expect(start).toContain('2026-11-24')
    expect(start).not.toContain('截止日')
    expect(start).not.toContain('自定义起止日')
    const shortMonth = renderToStaticMarkup(<BillingCycleSettings month="2024-03" cycle={{ mode: 'custom', day: 31, boundary: 'start' }} onChange={() => {}} />)
    expect(shortMonth).toContain('2024-02-29')
    expect(shortMonth).toContain('短月取月末')
  })

  it('selecting a day applies a custom cycle and selecting day one restores calendar months', () => {
    const changed = vi.fn()
    const tree = BillingCycleSettings({ month: '2026-11', cycle: { mode: 'calendar', day: 1, boundary: 'start' }, onChange: changed })
    function selectIn(node: unknown): ReactElement<{ children?: unknown; onChange?: (event: unknown) => void }> | undefined {
      if (!isValidElement<{ children?: unknown; onChange?: (event: unknown) => void }>(node)) return undefined
      if (node.type === 'select') return node
      for (const child of Children.toArray(node.props.children as never)) {
        const match = selectIn(child)
        if (match) return match
      }
      return undefined
    }
    const select = selectIn(tree)
    expect(select).toBeDefined()
    select!.props.onChange!({ target: { value: '25' } })
    expect(changed).toHaveBeenLastCalledWith({ mode: 'custom', day: 25, boundary: 'start' })
    select!.props.onChange!({ target: { value: '1' } })
    expect(changed).toHaveBeenLastCalledWith({ mode: 'calendar', day: 1, boundary: 'start' })
  })
})
