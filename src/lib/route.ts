import { useEffect, useState } from 'react'
import type { TransactionKind } from '../domain/types'

export type Page = 'overview' | 'transactions' | 'accounts' | 'settings'
export interface Route { page: Page; month: string; search: string; kind: TransactionKind | 'all'; account: string }
const pages = new Set(['overview', 'transactions', 'accounts', 'settings'])
const kinds = new Set(['all', 'income', 'expense', 'refund', 'transfer', 'investment'])

export function parseRoute(hash: string, defaultMonth = '2026-10'): Route {
  const [path, query] = hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(query)
  const month = params.get('month') ?? defaultMonth
  return {
    page: pages.has(path) ? path as Page : 'overview',
    month: /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) ? month : defaultMonth,
    search: params.get('q') ?? '',
    kind: kinds.has(params.get('kind') ?? '') ? params.get('kind') as Route['kind'] : 'all',
    account: params.get('account') ?? '',
  }
}

export function routeHref(page: Page, month: string, filters: Partial<Route> = {}): string {
  const params = new URLSearchParams({ month })
  if (filters.search) params.set('q', filters.search)
  if (filters.kind && filters.kind !== 'all') params.set('kind', filters.kind)
  if (filters.account) params.set('account', filters.account)
  return `#${page}?${params}`
}

export function useRoute(defaultMonth = '2026-10') {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash, defaultMonth))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash, defaultMonth))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [defaultMonth])
  const navigate = (patch: Partial<Route>, replace = false) => {
    const next = { ...route, ...patch }
    const hash = routeHref(next.page, next.month, next)
    if (replace) window.history.replaceState(null, '', hash)
    else if (window.location.hash !== hash) window.history.pushState(null, '', hash)
    setRoute(next)
    if (patch.page && patch.page !== route.page) window.scrollTo({ top: 0 })
  }
  return { route, navigate }
}
