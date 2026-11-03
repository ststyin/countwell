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
    const html = renderToStaticMarkup(<DisplayContext.Provider value={{ hidden: false, currency: 'CNY' }}><OverviewPage ledger={ledger} month="2026-11" currency="CNY" today="2026-10-25" cycle={{ mode: 'custom', day: 25, boundary: 'start' }} onNavigate={() => {}} /></DisplayContext.Provider>)
    const totals = html.slice(html.indexOf('class="flow-grid"'), html.indexOf('class="dashboard-grid"'))
    expect(totals).toContain('本期支出')
    expect(totals).toContain('10.00')
    expect(totals).not.toContain('20.00')
    expect(html).toContain('Inside billing period')
    expect(html).not.toContain('Outside billing period')
    expect(html).not.toContain('我的钱')
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
    expect(html).not.toContain('其他账户')
    expect(html).not.toContain('本月')
    expect(html).not.toContain('截至月末')
  })

  it('shows a monetary fund balance under investments, not cash or other assets', () => {
    const fund = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Assets:Investment:Fund:Example
2026-01-01 open Equity:Opening
2026-10-01 * "Opening"
  Assets:Bank 100 CNY
  Assets:Investment:Fund:Example 50 CNY
  Equity:Opening -150 CNY
`)
    const html = renderToStaticMarkup(<AccountsPage ledger={fund} currency="CNY" onAccount={() => {}} />)
    const cashSection = html.slice(html.indexOf('class="panel account-list-panel"'), html.indexOf('投资持仓'))
    expect(cashSection).not.toContain('Example')
    expect(html.slice(html.indexOf('投资持仓'))).toContain('Example')
    expect(html).not.toContain('其他账户')
    expect(html).toContain('150.00')
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
  it('keeps the clicked day in shareable links and filters across the billing boundary', () => {
    const cycle = { mode: 'custom', day: 25, boundary: 'start' } as const
    const link = routeHref('transactions', '2026-11', { date: '2026-10-25' })
    const route = parseRoute(link)
    expect(route.date).toBe('2026-10-25')
    const html = renderToStaticMarkup(<TransactionsPage ledger={ledger} currency="CNY" cycle={cycle} route={route} onFilter={() => {}} />)
    expect(html).toContain('Inside billing period')
    expect(html).not.toContain('Outside billing period')
    expect(html).toContain('2026-10-25')
    expect(parseRoute(routeHref('transactions', '2026-11', { date: '2026-02-30' })).date).toBeUndefined()
    const outside = renderToStaticMarkup(<TransactionsPage ledger={ledger} currency="CNY" cycle={cycle} route={{ ...route, date: '2026-11-25' }} onFilter={() => {}} />)
    expect(outside).not.toContain('Outside billing period')
    expect(outside).toContain('0 笔记录')
  })

  it('lists only today across all currencies, independently of the selected month', () => {
    const html = renderToStaticMarkup(<OverviewPage ledger={ledger} month="2026-10" currency="CNY" today="2026-12-02" onNavigate={() => {}} />)
    const recent = html.slice(html.indexOf('recent-panel'))
    expect(recent).toContain('今日 · 1 笔交易')
    expect(recent).toContain('Foreign balance')
    expect(recent).not.toContain('Inside billing period')
    expect(recent).not.toContain('Later source balance')
  })

  it('provides accessible targets for each day and preserves account-section links', () => {
    const html = renderToStaticMarkup(<OverviewPage ledger={ledger} month="2026-11" currency="CNY" today="2026-12-02" cycle={{ mode: 'custom', day: 25, boundary: 'start' }} onNavigate={() => {}} />)
    expect(html).toContain('查看 2026-10-25 的交易')
    expect(html).toContain('查看 2026-11-24 的交易')
    expect(html).not.toContain('查看 2026-11-25 的交易')
    expect(parseRoute(routeHref('accounts', '2026-11', { section: 'debt' })).section).toBe('debt')
  })

})
