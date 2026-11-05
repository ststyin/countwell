import { describe, expect, it } from 'vitest'
import { getAccounts, summarizeInvestments } from '../src/domain/reports'
import type { Ledger, LedgerTransaction, Posting } from '../src/domain/types'

const fund = 'Assets:Fund'
const p = (account: string, amount: string, currency = 'CNY', extra: Partial<Posting> = {}): Posting => ({ account, amount, currency, ...extra })
const lot = (amount: string, cost: string, date: string): Posting => p(fund, amount, 'FUND', { cost: { amount: cost, currency: 'CNY', date } })
const tx = (id: string, postings: Posting[]): LedgerTransaction => ({ id, date: `2026-10-${id.padStart(2, '0')}`, payee: '', narration: '', flag: '*', tags: [], postings })
const ledger: Ledger = {
  title: 'Synthetic sale at a loss', source: '', defaultMonth: '2026-10', commodities: ['FUND'], operatingCurrencies: ['CNY'],
  accounts: [
    { name: fund, label: 'Fund', kind: 'asset', role: 'investment' },
    { name: 'Assets:Bank', label: 'Bank', kind: 'asset', role: 'cash' },
    { name: 'Income:Gains', label: 'Gains', kind: 'income', role: 'other' },
    { name: 'Expenses:Fees', label: 'Fees', kind: 'expense', role: 'other' },
    { name: 'Equity:Opening', label: 'Opening', kind: 'equity', role: 'other' },
  ], accountNames: [fund, 'Assets:Bank', 'Income:Gains', 'Expenses:Fees', 'Equity:Opening'],
  transactions: [
    tx('1', [lot('10', '20', '2026-10-01'), p('Equity:Opening', '-200')]),
    tx('2', [lot('10', '10', '2026-10-02'), p('Assets:Bank', '-100')]),
    tx('3', [lot('-10', '20', '2026-10-01'), p('Assets:Bank', '120'), p('Income:Gains', '80')]),
  ], prices: [{ date: '2026-10-31', commodity: 'FUND', amount: '12', currency: 'CNY' }],
}
const summarize = (source = ledger) => summarizeInvestments(source, getAccounts(source, undefined, 'CNY'), 'CNY')

describe('investment lifetime performance', () => {
  it('shows an overall loss even when cheaper remaining lots are profitable', () => {
    expect(summarize().holdings[0]).toMatchObject({
      unrealizedPnl: '20', realizedPnl: '-80', cumulativePnl: '-60', invested: '300', withdrawn: '120',
      netInvested: '180', breakEvenPrice: '18', cumulativeReturnRate: '-20',
    })
  })
  it('keeps cumulative results invariant when a different valid cost lot is sold', () => {
    const otherLot = { ...ledger, transactions: [...ledger.transactions.slice(0, 2), tx('3', [lot('-10', '10', '2026-10-02'), p('Assets:Bank', '120'), p('Income:Gains', '-20')])] }
    expect(summarize(otherLot).holdings[0]).toMatchObject({ cumulativePnl: '-60', realizedPnl: '20', unrealizedPnl: '-80', netInvested: '180', breakEvenPrice: '18' })
  })

  it('uses net settlement and includes recorded buy and sell fees exactly once', () => {
    const source = { ...ledger, transactions: [ledger.transactions[0],
      tx('2', [lot('10', '10', '2026-10-02'), p('Assets:Bank', '-102'), p('Expenses:Fees', '2')]),
      tx('3', [lot('-10', '20', '2026-10-01'), p('Assets:Bank', '117'), p('Expenses:Fees', '3'), p('Income:Gains', '80')]),
    ] }
    expect(summarize(source).holdings[0]).toMatchObject({ invested: '302', withdrawn: '117', cumulativePnl: '-65', realizedPnl: '-85', unrealizedPnl: '20' })
  })

  it('keeps realized results available when the current quote is missing', () => {
    expect(summarize({ ...ledger, prices: [] }).holdings[0]).toMatchObject({ realizedPnl: '-80', invested: '300', withdrawn: '120', cumulativePnl: null, unrealizedPnl: null, cumulativeReturnRate: null })
  })

  it('does not reset losses when a fund is sold out and later bought again', () => {
    const source = { ...ledger, transactions: [...ledger.transactions,
      tx('4', [lot('-10', '10', '2026-10-02'), p('Assets:Bank', '110'), p('Income:Gains', '-10')]),
      tx('5', [lot('5', '11', '2026-10-05'), p('Assets:Bank', '-55')]),
    ] }
    expect(summarize(source).holdings[0]).toMatchObject({ invested: '355', withdrawn: '230', cumulativePnl: '-65', realizedPnl: '-70', unrealizedPnl: '5' })
  })

  it('uses the account report cutoff, including custom cycles, for the lifetime cash flows', () => {
    const source = { ...ledger, transactions: [...ledger.transactions.slice(0, 2), { ...ledger.transactions[2], date: '2026-10-26' }], prices: [{ ...ledger.prices[0], date: '2026-10-20' }] }
    const report = getAccounts(source, '2026-10', 'CNY', { mode: 'custom', day: 25, boundary: 'end' })
    expect(report.asOf).toBe('2026-10-25')
    expect(summarizeInvestments(source, report, 'CNY').holdings[0]).toMatchObject({ invested: '300', withdrawn: '0', realizedPnl: '0', units: '20' })
  })

  it('refuses ambiguous transfers, combined purchases, and mixed currencies', () => {
    const variants: Ledger[] = [
      { ...ledger, transactions: [...ledger.transactions, tx('4', [lot('1', '20', '2026-10-01'), { ...lot('-1', '20', '2026-10-01'), account: 'Assets:OtherFund' }])] },
      { ...ledger, transactions: [...ledger.transactions, tx('4', [lot('1', '12', '2026-10-04'), p('Assets:Fund', '1', 'SECOND', { cost: { amount: '20', currency: 'CNY' } }), p('Assets:Bank', '-32')])] },
      { ...ledger, transactions: [...ledger.transactions, tx('4', [lot('1', '12', '2026-10-04'), p('Assets:Bank', '-2', 'USD')])] },
      { ...ledger, transactions: [...ledger.transactions, tx('4', [lot('1', '12', '2026-10-04'), p('Income:Salary', '-12')])] },
    ]
    for (const source of variants) expect(summarize(source).holdings.find(item => item.commodity === 'FUND')).toMatchObject({ invested: null, withdrawn: null, cumulativePnl: null, realizedPnl: null })
  })

  it('does not turn a partial portfolio result into a complete cumulative total', () => {
    const source = { ...ledger, transactions: [...ledger.transactions, tx('4', [p('Assets:OtherFund', '1', 'OTHER', { cost: { amount: '10', currency: 'CNY' } })])], prices: [...ledger.prices, { date: '2026-10-31', commodity: 'OTHER', amount: '10', currency: 'CNY' }] }
    expect(summarize(source).totals[0]).toMatchObject({ invested: null, cumulativePnl: null, cumulativeReturnRate: null })
  })

  it('keeps independently funded foreign-currency holdings separate', () => {
    const source = { ...ledger, transactions: [...ledger.transactions, tx('4', [p('Assets:OtherFund', '1', 'OTHER', { cost: { amount: '10', currency: 'USD' } }), p('Assets:Bank', '-10', 'USD')])], prices: [...ledger.prices, { date: '2026-10-31', commodity: 'OTHER', amount: '11', currency: 'USD' }] }
    expect(summarize(source).totals).toMatchObject([{ currency: 'CNY', cumulativePnl: '-60', invested: '300', cumulativeReturnRate: '-20' }, { currency: 'USD', cumulativePnl: '1', invested: '10', cumulativeReturnRate: '10' }])
  })

  it('shows zero required recovery price once proceeds exceed contributions', () => {
    const source = { ...ledger, transactions: [...ledger.transactions.slice(0, 2), tx('3', [lot('-10', '20', '2026-10-01'), p('Assets:Bank', '350'), p('Income:Gains', '-150')])] }
    expect(summarize(source).holdings[0]).toMatchObject({ cumulativePnl: '170', realizedPnl: '150', netInvested: '-50', breakEvenPrice: '0' })
  })

})
