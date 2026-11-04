import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStartupViewportGate } from '../src/lib/viewport-navigation'

class TestViewport extends EventTarget { height = 812 }
class TestWindow extends EventTarget {
  innerHeight = 812
  visualViewport = new TestViewport()
  setTimeout = window.setTimeout.bind(window)
  clearTimeout = window.clearTimeout.bind(window)
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout, clearTimeout }) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('iPhone startup navigation', () => {
  it('replays the observed 812 → 874 viewport change without showing navigation at the shorter height', () => {
    const viewport = new TestWindow()
    const ready = vi.fn()
    const gate = createStartupViewportGate(viewport as unknown as Window, ready)
    gate.setLoading(false) // The ledger finished, but the viewport is still 812.
    vi.advanceTimersByTime(250)
    expect(ready).not.toHaveBeenCalled()
    viewport.innerHeight = viewport.visualViewport.height = 874
    viewport.visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(120)
    expect(ready).toHaveBeenCalledTimes(1)
    gate.dispose()
  })

  it('waits for the ledger even when the viewport expands first', () => {
    const viewport = new TestWindow(), ready = vi.fn()
    const gate = createStartupViewportGate(viewport as unknown as Window, ready)
    viewport.innerHeight = viewport.visualViewport.height = 874
    viewport.visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(5000)
    expect(ready).not.toHaveBeenCalled()
    gate.setLoading(false)
    vi.advanceTimersByTime(120)
    expect(ready).toHaveBeenCalledTimes(1)
    gate.dispose()
  })

  it('eventually exposes navigation after success or failure even when no resize arrives', () => {
    const viewport = new TestWindow(), ready = vi.fn()
    const gate = createStartupViewportGate(viewport as unknown as Window, ready)
    gate.setLoading(false)
    vi.advanceTimersByTime(1499)
    expect(ready).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ready).toHaveBeenCalledTimes(1)
    gate.dispose()
  })

  it('cancels pending timers and listeners when the app unmounts', () => {
    const viewport = new TestWindow(), ready = vi.fn()
    const gate = createStartupViewportGate(viewport as unknown as Window, ready)
    gate.setLoading(false)
    gate.dispose()
    viewport.visualViewport.height = 874
    viewport.visualViewport.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(3000)
    expect(ready).not.toHaveBeenCalled()
  })

  it('keeps a bounded fallback even if resize events keep arriving', () => {
    const viewport = new TestWindow(), ready = vi.fn()
    const gate = createStartupViewportGate(viewport as unknown as Window, ready)
    gate.setLoading(false)
    for (let index = 0; index < 15; index++) {
      vi.advanceTimersByTime(100)
      viewport.visualViewport.dispatchEvent(new Event('resize'))
    }
    expect(ready).toHaveBeenCalledTimes(1)
    gate.dispose()
  })
})
