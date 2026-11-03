import { afterEach, describe, expect, it, vi } from 'vitest'

function browserFixture(options: { dark?: boolean; saved?: string; blockedStorage?: boolean } = {}) {
  const values = new Map<string, string>([['countwell.theme', 'dark']])
  if (options.saved !== undefined) values.set('countwell.appearance', options.saved)
  const change = new Set<() => void>()
  const media = {
    matches: options.dark ?? false,
    addEventListener: vi.fn((_name: string, callback: () => void) => change.add(callback)),
    removeEventListener: vi.fn((_name: string, callback: () => void) => change.delete(callback)),
  }
  const dataset: Record<string, string> = {}
  const meta = { setAttribute: vi.fn() }
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => media),
    localStorage: {
      getItem(key: string) { if (options.blockedStorage) throw new Error('Storage unavailable'); return values.get(key) ?? null },
      setItem(key: string, value: string) { if (options.blockedStorage) throw new Error('Storage unavailable'); values.set(key, value) },
    },
  })
  vi.stubGlobal('document', { documentElement: { dataset }, querySelector: vi.fn(() => meta) })
  return { values, media, dataset, meta, change,
    system(dark: boolean) { media.matches = dark; change.forEach(callback => callback()) },
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('system-aware appearance', () => {
  it('defaults to the current system before render, ignoring the old auto-written theme key', async () => {
    const browser = browserFixture()
    const theme = await import('../src/hooks/useTheme')
    expect(theme.getThemeState()).toEqual({ preference: 'system', resolvedTheme: 'light' })
    expect(browser.dataset.theme).toBe('light')
    expect(browser.meta.setAttribute).toHaveBeenLastCalledWith('content', '#f6f5f0')
    const listener = vi.fn()
    const unsubscribe = theme.subscribeTheme(listener)
    browser.system(true)
    expect(theme.getThemeState()).toEqual({ preference: 'system', resolvedTheme: 'dark' })
    expect(browser.dataset.theme).toBe('dark')
    expect(browser.meta.setAttribute).toHaveBeenLastCalledWith('content', '#121413')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(browser.change.size).toBe(0)
  })

  it('persists manual overrides and resumes live system matching when automatic is selected', async () => {
    const browser = browserFixture({ dark: true })
    const theme = await import('../src/hooks/useTheme')
    const listener = vi.fn()
    const unsubscribe = theme.subscribeTheme(listener)
    theme.setThemePreference('light')
    expect(theme.getThemeState()).toEqual({ preference: 'light', resolvedTheme: 'light' })
    expect(browser.values.get('countwell.appearance')).toBe('light')
    browser.system(false)
    browser.system(true)
    expect(theme.getThemeState().resolvedTheme).toBe('light')
    theme.setThemePreference('system')
    expect(theme.getThemeState()).toEqual({ preference: 'system', resolvedTheme: 'dark' })
    expect(browser.values.get('countwell.appearance')).toBe('system')
    unsubscribe()
  })

  it('restores valid preferences, tolerates corrupt or unavailable storage, and ignores invalid changes', async () => {
    for (const options of [{ saved: 'dark' }, { saved: 'invalid' }, { blockedStorage: true }]) {
      vi.resetModules()
      const browser = browserFixture(options)
      const theme = await import('../src/hooks/useTheme')
      expect(theme.getThemeState().preference).toBe(options.saved === 'dark' ? 'dark' : 'system')
      theme.setThemePreference('dark')
      expect(browser.dataset.theme).toBe('dark')
      const snapshot = theme.getThemeState()
      theme.setThemePreference('invalid' as Parameters<typeof theme.setThemePreference>[0])
      expect(theme.getThemeState()).toBe(snapshot)
    }
  })

  it('shares one system listener and refreshes changes made while unsubscribed', async () => {
    const browser = browserFixture()
    const theme = await import('../src/hooks/useTheme')
    const first = theme.subscribeTheme(vi.fn())
    const second = theme.subscribeTheme(vi.fn())
    expect(browser.media.addEventListener).toHaveBeenCalledTimes(1)
    first()
    expect(browser.change.size).toBe(1)
    second()
    expect(browser.change.size).toBe(0)
    browser.system(true)
    const third = theme.subscribeTheme(vi.fn())
    expect(theme.getThemeState().resolvedTheme).toBe('dark')
    third()
  })
})
