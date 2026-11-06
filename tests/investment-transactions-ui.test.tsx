import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TransactionList from '../src/components/TransactionList'
import { DisplayContext } from '../src/components/ui'
import { getOverview, getPaymentAccountSpendingTransactions, getReceivingAccountIncomeTransactions, getTransactions } from '../src/domain'
import type { Ledger } from '../src/domain/types'
import { AccountFlowPanel } from '../src/pages/OverviewPage'

const ledger: Ledger = {
  title: 'Synthetic investment sale', source: '', defaultMonth: '2026-11', prices: [], commodities: ['FUND'],
  accountNames: ['Assets:Fund', 'Assets:Alipay', 'Income:CapitalGains'],
  accounts: [
    { name: 'Assets:Fund', label: '基金', kind: 'asset', role: 'investment' },
    { name: 'Assets:Alipay', label: '支付宝', kind: 'asset', role: 'cash' },
    { name: 'Income:CapitalGains', label: 'CapitalGains', kind: 'income', role: 'other' },
  ],
  transactions: [{ id: 'sale', date: '2026-11-06', payee: '', narration: '卖出基金', flag: '*', tags: [], postings: [
    { account: 'Assets:Fund', amount: '-10', currency: 'FUND', cost: { amount: '490.0000000000000000000000000000000052237', currency: 'CNY' } },
    { account: 'Assets:Alipay', amount: '4091.48', currency: 'CNY' },
    { account: 'Income:CapitalGains', amount: '808.52', currency: 'CNY' },
  ] }],
}

function summary(snapshot = ledger) {
  const html = renderToStaticMarkup(<TransactionList transactions={getTransactions(snapshot, { kind: 'income' })} />)
  return html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'))
}

describe('investment transaction presentation', () => {
  it('formats monetary summaries to two decimal places', () => {
    expect(summary()).not.toMatch(/\d+\.\d{3,}/)
    expect(summary()).toContain('4,900.00')
  })
  it('shows the actual receiving account and cash inflow independently of a realized loss', () => {
    expect(summary()).toContain('支付宝')
    expect(summary()).toContain('到账')
    expect(summary()).toContain('4,091.48')
    expect(summary()).toContain('已实现亏损')
    expect(summary()).not.toContain('收入冲回')
    expect(summary()).toContain('transaction-amount income-tone">+<span class="money ">4,091.48')
    expect(summary()).toContain('已实现亏损 −808.52')
    expect(getOverview(ledger, '2026-11').income).toBe('-808.52')
  })
  it('uses the net cash posting after fees, retaining gross gains and cost separately', () => {
    const snapshot: Ledger = { ...ledger, transactions: [{ ...ledger.transactions[0], postings: [
      { account: 'Assets:Fund', amount: '-10', currency: 'FUND', cost: { amount: '355.3185810530907134977576643957662', currency: 'CNY' } },
      { account: 'Assets:Alipay', amount: '4015.60', currency: 'CNY' },
      { account: 'Expenses:Investment:Fees', amount: '19.90', currency: 'CNY' },
      { account: 'Income:CapitalGains', amount: '-482.314189469092865022423356042338', currency: 'CNY' },
    ] }] }
    const html = summary(snapshot)
    expect(html).toContain('transaction-amount income-tone">+<span class="money ">4,015.60')
    expect(html).toContain('已实现盈利 +482.31')
    expect(html).toContain('支出 −19.90')
    expect(html).toContain('卖出成本 3,553.19')
    expect(html).not.toMatch(/\d+\.\d{3,}/)
    expect(getOverview(snapshot, '2026-11').expense).toBe('19.9')
  })
  it('attributes booked sale gains and fees to the cash account in both overview drilldowns', () => {
    const snapshot: Ledger = { ...ledger, transactions: [...ledger.transactions, { ...ledger.transactions[0], id: 'sale-with-fee', postings: [
      { account: 'Assets:Fund', amount: '-8', currency: 'FUND', cost: { amount: '40', currency: 'CNY' }, price: { amount: '55', currency: 'CNY' } },
      { account: 'Assets:Fund', amount: '-2', currency: 'FUND', cost: { amount: '40', currency: 'CNY' }, price: { amount: '55', currency: 'CNY' } },
      { account: 'Assets:Alipay', amount: '530', currency: 'CNY' },
      { account: 'Expenses:Investment:Fees', amount: '20', currency: 'CNY' },
      { account: 'Income:CapitalGains', amount: '-150', currency: 'CNY' },
    ] }] }
    const income = renderToStaticMarkup(<AccountFlowPanel ledger={snapshot} month="2026-11" mode="income" />)
    expect(income).toContain('-658.52')
    expect(income).toContain('含投资盈亏')
    const expense = renderToStaticMarkup(<AccountFlowPanel ledger={snapshot} month="2026-11" mode="expense" />)
    expect(expense).toContain('20.00')
    for (const panel of [income, expense]) {
      expect(panel).toContain('Alipay')
      expect(panel).not.toContain('Assets%3AFund')
      expect(panel).not.toContain('金额待确认')
    }
    const query = { month: '2026-11', account: 'Assets:Alipay', currency: 'CNY' }
    const incomeDetails = renderToStaticMarkup(<TransactionList transactions={getReceivingAccountIncomeTransactions(snapshot, query)} />)
    expect(incomeDetails).toContain('支付宝到账')
    expect(incomeDetails).toContain('4,091.48')
    expect(incomeDetails).toContain('已实现亏损 −808.52')
    const expenseDetails = renderToStaticMarkup(<TransactionList transactions={getPaymentAccountSpendingTransactions(snapshot, query)} />)
    expect(expenseDetails).toContain('支付宝到账')
    expect(expenseDetails).toContain('支出 −20.00')
  })
  it('preserves exact postings in the details and hides all amounts in privacy mode', () => {
    const rows = getTransactions(ledger, { kind: 'income' })
    const html = renderToStaticMarkup(<TransactionList transactions={rows} />)
    expect(html).toContain('490.0000000000000000000000000000000052237')
    const hidden = renderToStaticMarkup(<DisplayContext.Provider value={{ hidden: true, currency: 'CNY' }}><TransactionList transactions={rows} /></DisplayContext.Provider>)
    expect(hidden).not.toMatch(/4091|4,091|490\.000|4,900|808\.52/)
  })
  it('keeps multiple receiving accounts and currencies separate without inventing a combined inflow', () => {
    const snapshot: Ledger = { ...ledger, accounts: [...ledger.accounts, { name: 'Assets:Bank', label: '银行卡', kind: 'asset', role: 'cash' }],
      transactions: [{ ...ledger.transactions[0], postings: [ledger.transactions[0].postings[0],
        { account: 'Assets:Alipay', amount: '2000', currency: 'CNY' },
        { account: 'Assets:Bank', amount: '2091.48', currency: 'CNY' },
        ledger.transactions[0].postings[2],
      ] }] }
    expect(summary(snapshot)).toContain('支付宝到账 +2,000.00')
    expect(summary(snapshot)).toContain('银行卡到账 +2,091.48')
    expect(summary(snapshot)).not.toContain('4,091.48')
    snapshot.transactions[0].postings[2].currency = 'USD'
    expect(summary(snapshot)).toContain('银行卡到账 +2,091.48 USD')
  })
  it('labels buys as payments and does not manufacture cash for an in-kind movement', () => {
    const snapshot: Ledger = { ...ledger, transactions: [{ ...ledger.transactions[0], postings: [
      { account: 'Assets:Fund', amount: '10', currency: 'FUND', cost: { amount: '50', currency: 'CNY' } },
      { account: 'Assets:Alipay', amount: '-500', currency: 'CNY' },
    ] }] }
    const html = renderToStaticMarkup(<TransactionList transactions={getTransactions(snapshot, {})} />)
    expect(html).toContain('投资买入 · 支付宝付款')
    expect(html).toContain('transaction-amount expense-tone">−<span class="money ">500.00')
    snapshot.transactions[0].postings[1] = { account: 'Equity:Opening', amount: '-500', currency: 'CNY' }
    const inKind = renderToStaticMarkup(<TransactionList transactions={getTransactions(snapshot, {})} />)
    expect(inKind).not.toContain('到账')
    expect(inKind).not.toContain('付款')
  })
})
