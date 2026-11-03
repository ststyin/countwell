import { useSyncExternalStore } from 'react'
import { DEFAULT_BILLING_CYCLE } from '../domain/period'
import type { BillingCycle } from '../domain/types'

const storageKey = 'countwell.billingCycle'
const browser = typeof window !== 'undefined'
const listeners = new Set<() => void>()

function validCycle(value: unknown): value is BillingCycle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const cycle = value as Partial<BillingCycle>
  return (cycle.mode === 'calendar' || cycle.mode === 'custom')
    && Number.isInteger(cycle.day) && Number(cycle.day) >= 1 && Number(cycle.day) <= 31
    && (cycle.boundary === 'start' || cycle.boundary === 'end')
}

function normalize(cycle: BillingCycle): BillingCycle {
  return cycle.mode === 'calendar' ? { ...DEFAULT_BILLING_CYCLE }
    : { mode: 'custom', day: cycle.day, boundary: cycle.boundary }
}

function savedCycle(unavailableFallback: BillingCycle = DEFAULT_BILLING_CYCLE): BillingCycle {
  if (browser) {
    let saved: string | null
    try { saved = window.localStorage.getItem(storageKey) }
    catch { return { ...unavailableFallback } }
    try {
      const value: unknown = JSON.parse(saved ?? 'null')
      if (validCycle(value)) return normalize(value)
    } catch { /* Malformed preferences use calendar months. */ }
  }
  return { ...DEFAULT_BILLING_CYCLE }
}

let state = savedCycle()

function update(cycle: BillingCycle) {
  if (state.mode === cycle.mode && state.day === cycle.day && state.boundary === cycle.boundary) return
  state = cycle
  listeners.forEach(listener => listener())
}

function storageChanged(event: StorageEvent) {
  if (event.key === storageKey || event.key === null) update(savedCycle(state))
}

export function getBillingCycle(): BillingCycle { return state }

export function setBillingCycle(cycle: BillingCycle) {
  if (!validCycle(cycle)) return
  const next = normalize(cycle)
  try { if (browser) window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* The choice still applies for this session. */ }
  update(next)
}

export function subscribeBillingCycle(listener: () => void) {
  if (!listeners.size && browser) {
    window.addEventListener('storage', storageChanged)
    update(savedCycle(state))
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size && browser) window.removeEventListener('storage', storageChanged)
  }
}

export function useBillingCycle() {
  const cycle = useSyncExternalStore(subscribeBillingCycle, getBillingCycle, () => DEFAULT_BILLING_CYCLE)
  return { cycle, setCycle: setBillingCycle }
}
