import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
type ResolvedTheme = 'light' | 'dark'
interface ThemeState { preference: ThemePreference; resolvedTheme: ResolvedTheme }

const storageKey = 'countwell.appearance'
const serverState: ThemeState = { preference: 'system', resolvedTheme: 'light' }
const browser = typeof window !== 'undefined' && typeof document !== 'undefined'
const systemTheme = browser && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function savedPreference(): ThemePreference {
  if (!browser) return 'system'
  try {
    const saved = window.localStorage.getItem(storageKey)
    return isPreference(saved) ? saved : 'system'
  } catch { return 'system' }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme?.matches ? 'dark' : 'light' : preference
}

function applyTheme(theme: ResolvedTheme) {
  if (!browser) return
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f5f0' : '#121413')
}

let state: ThemeState = { preference: savedPreference(), resolvedTheme: 'light' }
state = { ...state, resolvedTheme: resolveTheme(state.preference) }
// Resolve before the first app render, including the signed-out login screen.
applyTheme(state.resolvedTheme)

function update(preference: ThemePreference) {
  const resolvedTheme = resolveTheme(preference)
  applyTheme(resolvedTheme)
  if (state.preference === preference && state.resolvedTheme === resolvedTheme) return
  state = { preference, resolvedTheme }
  listeners.forEach(listener => listener())
}

function systemChanged() { update(state.preference) }

export function setThemePreference(preference: ThemePreference) {
  if (!isPreference(preference)) return
  try { if (browser) window.localStorage.setItem(storageKey, preference) } catch { /* The selected theme still works without storage. */ }
  update(preference)
}

export function getThemeState() { return state }

export function subscribeTheme(listener: () => void) {
  if (listeners.size === 0) {
    systemTheme?.addEventListener('change', systemChanged)
    update(state.preference)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) systemTheme?.removeEventListener('change', systemChanged)
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeState, () => serverState)
  return { ...theme, setPreference: setThemePreference }
}
