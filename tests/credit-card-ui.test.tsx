import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDemoLedger } from '../src/domain'
import { parseRoute } from '../src/lib/route'
import { AccountFlowPanel } from '../src/pages/OverviewPage'
import TransactionsPage from '../src/pages/TransactionsPage'

const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Liabilities:CreditCard:CMB:Visa
2026-01-01 open Liabilities:CreditCard:RefundOnly
2026-01-01 open Liabilities:CreditCard:Inactive
2026-01-01 open Expenses:Food
2026-10-25 * "Purchase"
  Expenses:Food 100 CNY
  Liabilities:CreditCard:CMB:Visa -100 CNY
2026-10-26 * "Split"
  Expenses:Food 100 CNY
  Liabilities:CreditCard:CMB:Visa -40 CNY
  Assets:Bank -60 CNY
2026-10-27 * "Refund"
  Expenses:Food -30 CNY
  Liabilities:CreditCard:CMB:Visa 30 CNY
2026-10-28 * "Repayment"
  Liabilities:CreditCard:CMB:Visa 80 CNY
  Assets:Bank -80 CNY
2026-10-29 * "Refund only"
  Expenses:Food -15 CNY
  Liabilities:CreditCard:RefundOnly 15 CNY
2026-11-25 * "Next period"
  Expenses:Food 900 CNY
  Liabilities:CreditCard:CMB:Visa -900 CNY
`)
const cycle = { mode: 'custom', day: 25, boundary: 'start' } as const

describe('credit card spending drilldown', () => {
  it('shows only cards with activity, including a refund-only card, and links to the matching period', () => {
    const html = renderToStaticMarkup(<AccountFlowPanel ledger={ledger} month="2026-11" cycle={cycle} mode="expense" />)
    const cards = html
    expect(cards).toContain('支出账户')
    expect(cards).toContain('class="stat-card drilldown-card payment-spending-card"')
    expect(cards).not.toContain('信用卡消费')
    expect(cards).toContain('CreditCard:CMB:Visa')
    expect(cards).toContain('110.00')
    expect(cards).toContain('CreditCard:RefundOnly')
    expect(cards).toContain('-15.00')
    expect(cards).not.toContain('Inactive')
    const href = cards.match(/href="([^"]*CMB[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&')
    expect(href).toBeTruthy()
    expect(parseRoute(href!)).toMatchObject({ page: 'transactions', month: '2026-11', account: 'Liabilities:CreditCard:CMB:Visa', paymentCurrency: 'CNY' })
  })

  it('shows card-specific amounts and excludes repayments and transactions outside the period', () => {
    const route = parseRoute('#transactions?month=2026-11&account=Liabilities%3ACreditCard%3ACMB%3AVisa&card_currency=CNY')
    const html = renderToStaticMarkup(<TransactionsPage ledger={ledger} route={route} currency="CNY" cycle={cycle} onFilter={() => {}} />)
    expect(html).toContain('信用卡消费与退款')
    expect(html).toContain('3 笔记录')
    const summaries = [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map(match => match[1]).join('\n')
    expect(summaries).toContain('Purchase')
    expect(summaries).toContain('Split')
    expect(summaries).toContain('40.00')
    expect(summaries).toContain('Refund')
    expect(summaries).not.toContain('Repayment')
    expect(summaries).not.toContain('Next period')
    expect(summaries).not.toContain('900.00')
  })

  it('labels an ambiguous card share as unavailable rather than displaying a fabricated amount', () => {
    const mixed = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Liabilities:CreditCard:CMB:Visa
2026-01-01 open Expenses:Food
2026-11-01 * "Mixed purchase and advance"
  Expenses:Food 100 CNY
  Assets:Bank 50 CNY
  Liabilities:CreditCard:CMB:Visa -150 CNY
`)
    const overview = renderToStaticMarkup(<AccountFlowPanel ledger={mixed} month="2026-11" cycle={cycle} mode="expense" />)
    const cards = overview
    expect(cards).toContain('金额待确认')
    expect(cards).not.toContain('150.00')
    const route = parseRoute('#transactions?month=2026-11&account=Liabilities%3ACreditCard%3ACMB%3AVisa&card_currency=CNY')
    const details = renderToStaticMarkup(<TransactionsPage ledger={mixed} route={route} currency="CNY" cycle={cycle} onFilter={() => {}} />)
    const summary = details.match(/<summary>(.*?)<\/summary>/)?.[1] ?? ''
    expect(summary).toContain('金额待确认')
    expect(summary).not.toContain('150.00')
  })
})
