import { describe, expect, it } from 'vitest'
import { getCreditCardSpending, getCreditCardSpendingTransactions, parseDemoLedger } from '../src/domain'

const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Liabilities:CreditCard:CMB:Visa
2026-01-01 open Liabilities:CreditCard:Other
2026-01-01 open Liabilities:CreditCard:Zero
2026-01-01 open Liabilities:CreditCard:Inactive
2026-01-01 open Liabilities:MeituanMonthlyPay
2026-01-01 open Expenses:Food
2026-10-24 * "Before period"
  Expenses:Food 500 CNY
  Liabilities:CreditCard:CMB:Visa -500 CNY
2026-10-25 * "Card purchase"
  Expenses:Food 100 CNY
  Liabilities:CreditCard:CMB:Visa -100 CNY
2026-10-26 * "Split purchase"
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
  Liabilities:CreditCard:Other 15 CNY
2026-11-01 * "Offset purchase"
  Expenses:Food 20 CNY
  Liabilities:CreditCard:Zero -20 CNY
2026-11-02 * "Offset refund"
  Expenses:Food -20 CNY
  Liabilities:CreditCard:Zero 20 CNY
2026-11-03 * "Other liability"
  Expenses:Food 25 CNY
  Liabilities:MeituanMonthlyPay -25 CNY
2026-11-04 * "Cash advance"
  Assets:Bank 200 CNY
  Liabilities:CreditCard:Inactive -200 CNY
2026-11-05 * "Fee while repaying"
  Expenses:Food 5 CNY
  Liabilities:CreditCard:Inactive 100 CNY
  Assets:Bank -105 CNY
2026-11-06 * "USD purchase"
  Expenses:Food 7 USD
  Liabilities:CreditCard:CMB:Visa -7 USD
2026-11-25 * "Next period"
  Expenses:Food 900 CNY
  Liabilities:CreditCard:CMB:Visa -900 CNY
`)
const cycle = { mode: 'custom', day: 25, boundary: 'start' } as const

describe('credit card period spending', () => {
  it('uses the selected billing boundaries, deducts refunds, excludes repayments and preserves currencies', () => {
    expect(getCreditCardSpending(ledger, '2026-11', cycle)).toEqual([
      { account: 'Liabilities:CreditCard:CMB:Visa', currency: 'CNY', amount: '110', transactionCount: 3 },
      { account: 'Liabilities:CreditCard:CMB:Visa', currency: 'USD', amount: '7', transactionCount: 1 },
      { account: 'Liabilities:CreditCard:Other', currency: 'CNY', amount: '-15', transactionCount: 1 },
      { account: 'Liabilities:CreditCard:Zero', currency: 'CNY', amount: '0', transactionCount: 2 },
    ])
  })

  it('drills into exactly the matching card contributions, including the card share of split payments', () => {
    const rows = getCreditCardSpendingTransactions(ledger, { month: '2026-11', cycle, account: 'Liabilities:CreditCard:CMB:Visa', currency: 'CNY' })
    expect(rows.map(row => [row.narration, row.kind, row.amount])).toEqual([
      ['Refund', 'refund', '30'], ['Split purchase', 'expense', '40'], ['Card purchase', 'expense', '100'],
    ])
    expect(rows.every(row => !row.amountUnavailable)).toBe(true)
    expect(getCreditCardSpendingTransactions(ledger, { month: '2026-11', cycle, account: 'Liabilities:CreditCard:CMB:Visa', currency: 'CNY', search: 'split' }).map(row => row.narration)).toEqual(['Split purchase'])
  })

  it('honors an inclusive closing day and calendar-month selection', () => {
    const closing = { mode: 'custom', day: 25, boundary: 'end' } as const
    expect(getCreditCardSpending(ledger, '2026-11', closing)).toContainEqual({ account: 'Liabilities:CreditCard:CMB:Visa', currency: 'CNY', amount: '910', transactionCount: 3 })
    const calendar = getCreditCardSpending(ledger, '2026-11')
    expect(calendar).toContainEqual({ account: 'Liabilities:CreditCard:CMB:Visa', currency: 'CNY', amount: '900', transactionCount: 1 })
  })

  it('does not invent an allocation when a card funds both a purchase and cash advance', () => {
    const ambiguous = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Liabilities:CreditCard:CMB:Visa
2026-01-01 open Expenses:Food
2026-11-01 * "Mixed"
  Expenses:Food 100 CNY
  Assets:Bank 50 CNY
  Liabilities:CreditCard:CMB:Visa -150 CNY
`)
    expect(getCreditCardSpending(ambiguous, '2026-11', cycle)).toMatchObject([{ amount: null, transactionCount: 1 }])
    expect(getCreditCardSpendingTransactions(ambiguous, { month: '2026-11', cycle, account: 'Liabilities:CreditCard:CMB:Visa', currency: 'CNY' })[0].amountUnavailable).toBe(true)
  })

  it('splits a purchase between cards without duplicating the whole expense', () => {
    const split = parseDemoLedger(`
2026-01-01 open Liabilities:CreditCard:First
2026-01-01 open Liabilities:信用卡:Second
2026-01-01 open Expenses:Food
2026-11-01 * "Two cards"
  Expenses:Food 100 CNY
  Liabilities:CreditCard:First -40 CNY
  Liabilities:信用卡:Second -60 CNY
`)
    expect(getCreditCardSpending(split, '2026-11', cycle)).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: 'Liabilities:CreditCard:First', amount: '40' }),
      expect.objectContaining({ account: 'Liabilities:信用卡:Second', amount: '60' }),
    ]))
    expect(getCreditCardSpendingTransactions(split, { month: '2026-11', cycle, account: 'Liabilities:信用卡:Second', currency: 'CNY' })[0].amount).toBe('60')
  })

  it('keeps a net-zero mixed card posting visible but marks its amount uncertain', () => {
    const mixed = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Liabilities:CreditCard:CMB:Visa
2026-01-01 open Expenses:Food
2026-11-01 * "Purchase and repayment"
  Expenses:Food 100 CNY
  Liabilities:CreditCard:CMB:Visa -100 CNY
  Liabilities:CreditCard:CMB:Visa 100 CNY
  Assets:Bank -100 CNY
`)
    expect(getCreditCardSpending(mixed, '2026-11', cycle)).toMatchObject([{ amount: null, transactionCount: 1 }])
  })
})
