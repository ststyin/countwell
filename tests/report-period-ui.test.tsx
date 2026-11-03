import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDemoLedger } from '../src/domain'
import { DisplayContext } from '../src/components/ui'
import OverviewPage from '../src/pages/OverviewPage'
import AccountsPage from '../src/pages/AccountsPage'
import TransactionsPage from '../src/pages/TransactionsPage'
import { parseRoute, routeHref } from '../src/lib/route'

const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Assets:Foreign
2026-01-01 open Assets:Unused
2026-01-01 open Equity:Opening
2026-01-01 open Expenses:Food
2026-09-01 * "Opening"
  Assets:Bank 100 CNY
  Equity:Opening -100 CNY
2026-10-25 * "Inside billing period"
  Expenses:Food 10 CNY
  Assets:Bank -10 CNY
2026-11-25 * "Outside billing period"
  Expenses:Food 20 CNY
  Assets:Bank -20 CNY
2026-12-01 * "Later source balance"
  Assets:Bank 50 CNY
  Equity:Opening -50 CNY
2026-12-02 * "Foreign balance"
  Assets:Foreign 7.5 USD
  Equity:Opening -7.5 USD
`)

describe('report period presentation', () => {
  it('passes the selected cycle to totals, daily chart and recent transaction data', () => {
    const html = renderToStaticMarkup(<DisplayContext.Provider value={{ hidden: false, currency: 'CNY' }}><OverviewPage ledger={ledger} month="2026-11" currency="CNY" cycle={{ mode: 'custom', day: 25, boundary: 'start' }} onNavigate={() => {}} /></DisplayContext.Provider>)
    const totals = html.slice(html.indexOf('class="flow-grid"'), html.indexOf('class="balance-strip"'))
    expect(totals).toContain('本期支出')
    expect(totals).toContain('10.00')
    expect(totals).not.toContain('20.00')
    expect(html).toContain('Inside billing period')
    expect(html).not.toContain('Outside billing period')
    expect(html).toContain('10.25')
    expect(html).toContain('11.24')
  })

  it('shows later balances, foreign accounts and declared unused accounts without monthly comparisons', () => {
    const html = renderToStaticMarkup(<DisplayContext.Provider value={{ hidden: false, currency: 'CNY' }}><AccountsPage ledger={ledger} currency="CNY" onAccount={() => {}} /></DisplayContext.Provider>)
    expect(html).toContain('120.00')
    expect(html).toContain('7.50')
    expect(html).toContain('USD')
    expect(html).toContain('Unused')
    expect(html).toContain('暂无记录')
    expect(html).not.toContain('本月')
    expect(html).not.toContain('截至月末')
  })

  it('retains all-time account drilldown in shareable routes and can switch back to a period', () => {
    const all = routeHref('transactions', '2026-11', { account: 'Assets:Bank', allTime: true })
    expect(parseRoute(all)).toMatchObject({ page: 'transactions', month: '2026-11', account: 'Assets:Bank', allTime: true })
    const monthly = routeHref('transactions', '2026-11', { account: 'Assets:Bank', allTime: false })
    expect(parseRoute(monthly).allTime).toBeUndefined()
  })

  it('keeps category drilldowns in CNY while financial accounts include their foreign history', () => {
    const mixed = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Expenses:Food
2026-10-25 * "CNY purchase"
  Expenses:Food 10 CNY
  Assets:Bank -10 CNY
2026-10-28 * "USD purchase"
  Expenses:Food 5 USD
  Assets:Bank -5 USD
`)
    const cycle = { mode: 'custom', day: 25, boundary: 'start' } as const
    const category = renderToStaticMarkup(<TransactionsPage ledger={mixed} currency="CNY" cycle={cycle} route={{ page: 'transactions', month: '2026-11', kind: 'expense', search: '', account: 'Expenses:Food' }} onFilter={() => {}} />)
    expect(category).toContain('1 笔记录')
    expect(category).toContain('CNY purchase')
    expect(category).not.toContain('USD purchase')
    const account = renderToStaticMarkup(<TransactionsPage ledger={mixed} currency="CNY" cycle={cycle} route={{ page: 'transactions', month: '2026-11', kind: 'all', search: '', account: 'Assets:Bank', allTime: true }} onFilter={() => {}} />)
    expect(account).toContain('2 笔记录')
    expect(account).toContain('USD purchase')
  })
})
