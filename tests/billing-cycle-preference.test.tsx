import { renderToStaticMarkup } from 'react-dom/server'
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

  it('restores either boundary mode after reload and only persists period preferences', async () => {
    const browser = browserFixture()
    for (const boundary of ['start', 'end'] as const) {
      const preference = await import('../src/hooks/useBillingCycle')
      preference.setBillingCycle({ mode: 'custom', day: 25, boundary, unexpected: 'private sentinel' } as Parameters<typeof preference.setBillingCycle>[0])
      expect(JSON.parse(browser.values.get(key)!)).toEqual({ mode: 'custom', day: 25, boundary })
      expect(browser.values.get(key)).not.toContain('sentinel')
      vi.resetModules()
      const restored = await import('../src/hooks/useBillingCycle')
      expect(restored.getBillingCycle()).toEqual({ mode: 'custom', day: 25, boundary })
    }
  })

  it('shares updates between active views and tabs and cleans up the storage listener', async () => {
    const browser = browserFixture()
    const preference = await import('../src/hooks/useBillingCycle')
    const firstListener = vi.fn(), secondListener = vi.fn()
    const first = preference.subscribeBillingCycle(firstListener)
    const second = preference.subscribeBillingCycle(secondListener)
    expect(browser.addEventListener).toHaveBeenCalledTimes(1)
    preference.setBillingCycle({ mode: 'custom', day: 31, boundary: 'end' })
    expect(firstListener).toHaveBeenCalledTimes(1)
    expect(secondListener).toHaveBeenCalledTimes(1)
    preference.setBillingCycle({ mode: 'custom', day: 31, boundary: 'end' })
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
    preference.setBillingCycle({ mode: 'custom', day: 25, boundary: 'end' })
    const stop = preference.subscribeBillingCycle(vi.fn())
    expect(preference.getBillingCycle()).toEqual({ mode: 'custom', day: 25, boundary: 'end' })
    stop()
    const current = preference.getBillingCycle()
    preference.setBillingCycle({ mode: 'custom', day: 99, boundary: 'end' })
    expect(preference.getBillingCycle()).toBe(current)
    preference.setBillingCycle({ mode: 'calendar', day: 25, boundary: 'end' })
    expect(preference.getBillingCycle()).toEqual({ mode: 'calendar', day: 1, boundary: 'start' })
  })

  it('previews the dates actually included for both boundary choices', () => {
    const start = renderToStaticMarkup(<BillingCycleSettings month="2026-11" cycle={{ mode: 'custom', day: 25, boundary: 'start' }} onChange={() => {}} />)
    expect(start).toContain('2026-10-25')
    expect(start).toContain('2026-11-24')
    expect(start).toContain('25 日计入新一期')
    const end = renderToStaticMarkup(<BillingCycleSettings month="2026-11" cycle={{ mode: 'custom', day: 25, boundary: 'end' }} onChange={() => {}} />)
    expect(end).toContain('2026-10-26')
    expect(end).toContain('2026-11-25')
    expect(end).toContain('25 日计入本期')
  })
})
