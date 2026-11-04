import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const scenario = vi.hoisted(() => ({ ios: true, standalone: true, loading: true }))
vi.mock('../src/lib/runtime', () => ({ cloudMode: true }))
vi.mock('../src/hooks/usePwa', () => ({ usePwa: () => ({ ios: scenario.ios, isStandalone: scenario.standalone, offline: false, updateAvailable: false }) }))
vi.mock('../src/hooks/useTheme', () => ({ useTheme: () => ({ preference: 'system', setPreference: vi.fn() }) }))
vi.mock('../src/hooks/useBillingCycle', () => ({ useBillingCycle: () => ({ cycle: { mode: 'calendar', day: 1, boundary: 'start' }, setCycle: vi.fn() }) }))
vi.mock('../src/hooks/useLedgerSource', () => ({ useLedgerSource: () => ({
  ledger: { title: 'Countwell', source: '', defaultMonth: '2026-11', transactions: [], accounts: [], prices: [], commodities: [] },
  status: null, initialLoading: scenario.loading, needsConnection: true, backendAvailable: null, error: null, real: false, refreshStatus: vi.fn(),
}) }))
vi.mock('../src/lib/route', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/route')>(),
  useRoute: () => ({ route: { page: 'overview', month: '2026-11', search: '', kind: 'all', account: '' }, navigate: vi.fn() }),
}))

import App from '../src/App'

afterEach(() => { scenario.ios = true; scenario.standalone = true; scenario.loading = true })

describe('iPhone PWA startup layout', () => {
  it('does not expose the floating navigation before the startup viewport settles', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('正在读取账本')
    expect(html).not.toContain('aria-label="手机导航"')
    expect(html).toContain('前往设置')
  })

  it('keeps navigation visible in a regular browser and when startup has already finished', () => {
    scenario.standalone = false
    expect(renderToStaticMarkup(<App />)).toContain('aria-label="手机导航"')
    scenario.standalone = true
    scenario.ios = false
    expect(renderToStaticMarkup(<App />)).toContain('aria-label="手机导航"')
    scenario.ios = true
    scenario.loading = false
    expect(renderToStaticMarkup(<App />)).toContain('aria-label="手机导航"')
  })
})
