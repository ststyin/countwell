import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDemoLedger } from '../src/domain'
import { parseRoute, routeHref } from '../src/lib/route'
import RecordPage from '../src/pages/RecordPage'

describe('record expense page', () => {
  it('offers the requested fields and only payment or expense accounts', () => {
    const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Assets:Wallet:Alipay
2026-01-01 open Assets:Investment:Broker:Debit
2026-01-01 open Assets:Investment:Fund:EFAI
2026-01-01 open Assets:Investment:Fund:CXRobot
2026-01-01 open Assets:Receivables:Friend
2026-01-01 open Liabilities:CreditCard
2026-01-01 open Expenses:Food
2026-01-01 open Income:Salary
`)
    const html = renderToStaticMarkup(<RecordPage ledger={ledger} />)
    for (const label of ['支出金额', '支付方式', '支出分类', '日期', '交易方式', '描述', '保存并提交', 'Bank', 'CreditCard', 'Food']) expect(html).toContain(label)
    const paymentSelect = html.match(/<select[^>]*>[\s\S]*?<\/select>/)?.[0] ?? ''
    for (const name of ['Bank', 'Wallet:Alipay', 'Investment:Broker:Debit', 'CreditCard']) expect(paymentSelect).toContain(name)
    for (const name of ['EFAI', 'CXRobot', 'Receivables:Friend', 'Income:Salary']) expect(paymentSelect).not.toContain(name)
    expect(html).not.toContain('交易对象')
    expect(parseRoute(routeHref('record', '2026-11')).page).toBe('record')
  })
})
