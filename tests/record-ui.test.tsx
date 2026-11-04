import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseDemoLedger } from '../src/domain'
import { parseRoute, routeHref } from '../src/lib/route'
import RecordPage from '../src/pages/RecordPage'

describe('record expense page', () => {
  it('offers the requested fields and only payment or expense accounts', () => {
    const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Liabilities:CreditCard
2026-01-01 open Expenses:Food
2026-01-01 open Income:Salary
`)
    const html = renderToStaticMarkup(<RecordPage ledger={ledger} />)
    for (const label of ['支出金额', '支付方式', '支出分类', '日期', '交易对象', '描述', '保存并提交', 'Bank', 'CreditCard', 'Food']) expect(html).toContain(label)
    expect(html).not.toContain('Income:Salary')
    expect(parseRoute(routeHref('record', '2026-11')).page).toBe('record')
  })
})
