import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getReceivingAccountIncome, getReceivingAccountIncomeTransactions, parseDemoLedger } from '../src/domain'
import { parseRoute } from '../src/lib/route'
import OverviewPage, { AccountFlowPanel } from '../src/pages/OverviewPage'
import TransactionsPage from '../src/pages/TransactionsPage'

const cycle = { mode: 'custom', day: 25, boundary: 'start' } as const
const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Assets:Alipay
2026-01-01 open Assets:Unused
2026-01-01 open Income:Salary
2026-01-01 open Expenses:Food
2026-10-24 * "Previous salary"
  Assets:Bank 999 CNY
  Income:Salary -999 CNY
2026-10-25 * "Split salary"
  Assets:Bank 600 CNY
  Assets:Alipay 400 CNY
  Income:Salary -1000 CNY
2026-10-27 * "Income reversal"
  Income:Salary 50 CNY
  Assets:Bank -50 CNY
2026-10-28 * "Transfer"
  Assets:Alipay 10 CNY
  Assets:Bank -10 CNY
2026-10-29 * "Expense refund"
  Expenses:Food -30 CNY
  Assets:Bank 30 CNY
2026-11-01 * "Foreign income"
  Assets:Bank 7 USD
  Income:Salary -7 USD
2026-11-25 * "Next salary"
  Assets:Bank 999 CNY
  Income:Salary -999 CNY
`)

describe('overview income and expense account drilldown', () => {
  it('starts with surplus, then income and expense; both account panels are collapsed', () => {
    const html = renderToStaticMarkup(<OverviewPage ledger={ledger} month="2026-11" cycle={cycle} currency="CNY" today="2026-12-01" onNavigate={() => {}} />)
    const summary = html.slice(html.indexOf('class="flow-grid"'), html.indexOf('class="dashboard-grid"'))
    expect(summary.indexOf('本期结余')).toBeLessThan(summary.indexOf('本期收入'))
    expect(summary.indexOf('本期收入')).toBeLessThan(summary.indexOf('本期支出'))
    expect(summary.match(/aria-expanded="false"/g)).toHaveLength(2)
    expect(summary).not.toContain('收入账户')
    expect(summary).not.toContain('支出账户')
  })

  it('aggregates receiving accounts and reversals, excluding transfers, refunds and other periods', () => {
    expect(getReceivingAccountIncome(ledger, '2026-11', cycle)).toEqual([
      { account: 'Assets:Alipay', currency: 'CNY', amount: '400', transactionCount: 1 },
      { account: 'Assets:Bank', currency: 'CNY', amount: '550', transactionCount: 2 },
      { account: 'Assets:Bank', currency: 'USD', amount: '7', transactionCount: 1 },
    ])
    expect(getReceivingAccountIncomeTransactions(ledger, { month: '2026-11', cycle, account: 'Assets:Bank', currency: 'CNY' }).map(row => [row.narration, row.amount, row.direction])).toEqual([
      ['Income reversal', '50', 'out'], ['Split salary', '600', 'in'],
    ])
    const panel = renderToStaticMarkup(<AccountFlowPanel ledger={ledger} month="2026-11" cycle={cycle} mode="income" />)
    expect(panel).toContain('收入账户')
    expect(panel).toContain('550.00')
    expect(panel).toContain('400.00')
    expect(panel).not.toContain('Unused')
    const href = panel.match(/href="([^"]*Bank[^\"]*income_currency=CNY[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&')
    expect(href).toBeTruthy()
    const route = parseRoute(href!)
    expect(route).toMatchObject({ page: 'transactions', month: '2026-11', account: 'Assets:Bank', incomeCurrency: 'CNY' })
    const details = renderToStaticMarkup(<TransactionsPage ledger={ledger} route={route} currency="CNY" cycle={cycle} onFilter={() => {}} />)
    expect(details).toContain('收入与收入冲回')
    expect(details).toContain('Split salary')
    expect(details).toContain('Income reversal')
    expect(details).not.toContain('Transfer')
    expect(details).not.toContain('Expense refund')
    expect(details).not.toContain('Foreign income')
    expect(details).not.toContain('Previous salary')
    expect(details).not.toContain('Next salary')
  })

  it('does not invent income amounts for mixed income and unrelated transfers', () => {
    const mixed = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Assets:Other
2026-01-01 open Income:Salary
2026-11-01 * "Income and transfer"
  Assets:Bank 150 CNY
  Assets:Other -50 CNY
  Income:Salary -100 CNY
`)
    expect(getReceivingAccountIncome(mixed, '2026-11', cycle)[0].amount).toBeNull()
    expect(getReceivingAccountIncomeTransactions(mixed, { month: '2026-11', cycle, account: 'Assets:Bank', currency: 'CNY' })[0].amountUnavailable).toBe(true)
    const panel = renderToStaticMarkup(<AccountFlowPanel ledger={mixed} month="2026-11" cycle={cycle} mode="income" />)
    expect(panel).toContain('金额待确认')
    expect(panel).not.toContain('150.00')
  })
})
