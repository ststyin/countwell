import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getPaymentAccountSpending, getPaymentAccountSpendingTransactions, parseDemoLedger } from '../src/domain'
import { parseRoute } from '../src/lib/route'
import { AccountFlowPanel } from '../src/pages/OverviewPage'
import TransactionsPage from '../src/pages/TransactionsPage'

const ledger = parseDemoLedger(`
2026-01-01 open Assets:Alipay
2026-01-01 open Assets:Bank:Debit
2026-01-01 open Assets:Unused
2026-01-01 open Liabilities:CreditCard:Visa
2026-01-01 open Liabilities:MonthlyPay
2026-01-01 open Expenses:Food
2026-10-24 * "Outside"
  Expenses:Food 900 CNY
  Assets:Alipay -900 CNY
2026-10-25 * "Alipay purchase"
  Expenses:Food 100 CNY
  Assets:Alipay -100 CNY
2026-10-26 * "Split purchase"
  Expenses:Food 100 CNY
  Assets:Alipay -40 CNY
  Liabilities:CreditCard:Visa -60 CNY
2026-10-27 * "Alipay refund"
  Expenses:Food -30 CNY
  Assets:Alipay 30 CNY
2026-10-28 * "Card repayment"
  Assets:Bank:Debit -80 CNY
  Liabilities:CreditCard:Visa 80 CNY
2026-10-29 * "Monthly pay"
  Expenses:Food 25 CNY
  Liabilities:MonthlyPay -25 CNY
2026-10-30 * "Refund only"
  Expenses:Food -15 CNY
  Assets:Bank:Debit 15 CNY
2026-11-01 * "Foreign purchase"
  Expenses:Food 7 USD
  Assets:Alipay -7 USD
2026-11-25 * "Next period"
  Expenses:Food 500 CNY
  Assets:Alipay -500 CNY
`)
const cycle = { mode: 'custom', day: 25, boundary: 'start' } as const

describe('payment account spending', () => {
  it('attributes spending and refunds to each account, excluding transfers and keeping currencies separate', () => {
    expect(getPaymentAccountSpending(ledger, '2026-11', cycle)).toEqual([
      { account: 'Assets:Alipay', currency: 'CNY', amount: '110', transactionCount: 3 },
      { account: 'Assets:Alipay', currency: 'USD', amount: '7', transactionCount: 1 },
      { account: 'Assets:Bank:Debit', currency: 'CNY', amount: '-15', transactionCount: 1 },
      { account: 'Liabilities:CreditCard:Visa', currency: 'CNY', amount: '60', transactionCount: 1 },
      { account: 'Liabilities:MonthlyPay', currency: 'CNY', amount: '25', transactionCount: 1 },
    ])
    expect(getPaymentAccountSpendingTransactions(ledger, { month: '2026-11', cycle, account: 'Assets:Alipay', currency: 'CNY' }).map(row => [row.narration, row.amount, row.kind])).toEqual([
      ['Alipay refund', '30', 'refund'], ['Split purchase', '40', 'expense'], ['Alipay purchase', '100', 'expense'],
    ])
  })

  it('uses the same cards as income and surplus, linking an account to its exact spending and refunds', () => {
    const html = renderToStaticMarkup(<AccountFlowPanel ledger={ledger} month="2026-11" cycle={cycle} mode="expense" />)
    const section = html
    expect(section).toContain('Alipay')
    expect(section).toContain('110.00')
    expect(section).toContain('CreditCard:Visa')
    expect(section).toContain('60.00')
    expect(section).not.toContain('Unused')
    const href = section.match(/href="([^"]*Alipay[^\"]*payment_currency=CNY[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&')
    expect(href).toBeTruthy()
    const route = parseRoute(href!)
    expect(route).toMatchObject({ page: 'transactions', account: 'Assets:Alipay', paymentCurrency: 'CNY', month: '2026-11' })
    const details = renderToStaticMarkup(<TransactionsPage ledger={ledger} route={route} currency="CNY" cycle={cycle} onFilter={() => {}} />)
    expect(details).toContain('支出与退款')
    expect(details).toContain('Alipay refund')
    expect(details).toContain('Split purchase')
    expect(details).not.toContain('Card repayment')
    expect(details).not.toContain('Next period')
  })

  it('does not invent shares if multiple payment legs also fund an unrelated transfer', () => {
    const mixed = parseDemoLedger(`
2026-01-01 open Assets:Alipay
2026-01-01 open Assets:Bank
2026-01-01 open Assets:Other
2026-01-01 open Expenses:Food
2026-11-01 * "Purchase and transfer"
  Expenses:Food 100 CNY
  Assets:Alipay -70 CNY
  Assets:Bank -50 CNY
  Assets:Other 20 CNY
`)
    const totals = getPaymentAccountSpending(mixed, '2026-11', cycle)
    expect(totals).toHaveLength(2)
    expect(totals.every(row => row.amount === null)).toBe(true)
    expect(getPaymentAccountSpendingTransactions(mixed, { month: '2026-11', cycle, account: 'Assets:Alipay', currency: 'CNY' })[0].amountUnavailable).toBe(true)
  })
})
