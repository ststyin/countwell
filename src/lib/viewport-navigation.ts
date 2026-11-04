/** Keep startup navigation hidden until iOS has finished growing its viewport. */
export function createStartupViewportGate(view: Window, onReady: () => void) {
  const viewport = view.visualViewport
  const initialHeight = viewport?.height ?? view.innerHeight
  let loading = true
  let expanded = false
  let active = true
  let fallback: number | undefined
  let settle: number | undefined

  const dispose = () => {
    active = false
    if (fallback !== undefined) view.clearTimeout(fallback)
    if (settle !== undefined) view.clearTimeout(settle)
    viewport?.removeEventListener('resize', onResize)
    view.removeEventListener('resize', onResize)
  }
  const finish = () => {
    if (!active) return
    dispose()
    onReady()
  }
  const settleAfterExpansion = () => {
    if (settle !== undefined) view.clearTimeout(settle)
    settle = view.setTimeout(finish, 120)
  }
  function onResize() {
    if ((viewport?.height ?? view.innerHeight) > initialHeight + 1) expanded = true
    if (!loading && expanded) settleAfterExpansion()
  }
  viewport?.addEventListener('resize', onResize)
  view.addEventListener('resize', onResize)

  return {
    setLoading(next: boolean) {
      if (!active || next === loading) return
      loading = next
      if (fallback !== undefined) view.clearTimeout(fallback)
      if (settle !== undefined) view.clearTimeout(settle)
      fallback = settle = undefined
      if (!loading) {
        // Some devices never resize. Restore navigation even on errors or offline.
        fallback = view.setTimeout(finish, 1500)
        if (expanded) settleAfterExpansion()
      }
    },
    dispose,
  }
}
