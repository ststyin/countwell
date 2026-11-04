import { useEffect, useRef, useState } from 'react'
import { createStartupViewportGate } from '../lib/viewport-navigation'

/** Only defer the first iOS standalone launch while the ledger is loading. */
export function useStartupNavigation(iosStandalone: boolean, loading: boolean, alreadyPrefetched = false) {
  const [ready, setReady] = useState(() => !iosStandalone || (!loading && !alreadyPrefetched))
  const gate = useRef<ReturnType<typeof createStartupViewportGate> | null>(null)

  useEffect(() => {
    if (ready) return
    if (!iosStandalone) { setReady(true); return }
    const current = createStartupViewportGate(window, () => setReady(true))
    gate.current = current
    current.setLoading(loading)
    return () => { current.dispose(); if (gate.current === current) gate.current = null }
  }, [iosStandalone, ready])

  useEffect(() => { gate.current?.setLoading(loading) }, [loading])
  return ready
}
