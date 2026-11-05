import { describe, expect, it } from 'vitest'
import { getAccounts, summarizeInvestments } from '../src/domain/reports'
import type { Ledger } from '../src/domain/types'
import { investmentLabels } from '../src/lib/investmentLabels'

const ledger: Ledger = {
  title: 'Synthetic portfolio', source: '', defaultMonth: '2026-11', commodities: ['FUND', 'STOCK'], operatingCurrencies: ['CNY', 'USD'],
  accounts: [{ name: 'Assets:Broker', label: 'Broker', kind: 'asset', role: 'investment' }], accountNames: ['Assets:Broker'],
  transactions: [
    { id: 'buy', date: '2026-10-01', payee: '', narration: '', flag: '*', tags: [], postings: [
      { account: 'Assets:Broker', amount: '3', currency: 'FUND', cost: { amount: '2', currency: 'CNY', date: '2026-10-01' } },
      { account: 'Assets:Broker', amount: '5', currency: 'STOCK', cost: { amount: '4', currency: 'USD', date: '2026-10-01' } },
    ] },
    { id: 'sell', date: '2026-10-02', payee: '', narration: '', flag: '*', tags: [], postings: [
      { account: 'Assets:Broker', amount: '-1', currency: 'FUND', cost: { amount: '2', currency: 'CNY', date: '2026-10-01' } },
    ] },
  ],
  prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '3', currency: 'CNY' }, { date: '2026-11-01', commodity: 'STOCK', amount: '3', currency: 'USD' }],
}
const summary = (source = ledger) => summarizeInvestments(source, getAccounts(source, undefined, 'CNY'), 'CNY')

describe('investment overview calculations', () => {
  it('reports only remaining shares and keeps portfolio values and returns separate by currency', () => {
    const result = summary()
    expect(result.holdings[0]).toMatchObject({ units: '2', averageCost: '2', returnRate: '50' })
    expect(result.totals).toEqual([
      { currency: 'CNY', count: 1, marketValue: '6', cost: '4', unrealizedPnl: '2', returnRate: '50' },
      { currency: 'USD', count: 1, marketValue: '15', cost: '20', unrealizedPnl: '-5', returnRate: '-25' },
    ])
  })

  it('does not invent a portfolio total with missing quotes or a return with mixed-currency costs', () => {
    const source = { ...ledger, prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '3', currency: 'USD' }] }
    expect(summary(source).totals.every(total => total.marketValue === null && total.unrealizedPnl === null && total.returnRate === null)).toBe(true)
    const mixed = { ...ledger, prices: [...ledger.prices, { date: '2026-11-01', commodity: 'STOCK', amount: '30', currency: 'CNY' }] }
    expect(summary(mixed).totals).toEqual([{ currency: 'CNY', count: 2, marketValue: '156', cost: null, unrealizedPnl: null, returnRate: null }])
  })

  it('weights cost by remaining units and does not average individual return percentages', () => {
    const source: Ledger = { ...ledger, transactions: [{ ...ledger.transactions[0], postings: [
      { account: 'Assets:Broker', amount: '2', currency: 'FUND', cost: { amount: '1', currency: 'CNY' } },
      { account: 'Assets:Broker', amount: '3', currency: 'FUND', cost: { amount: '2', currency: 'CNY' } },
    ] }] }
    expect(summary(source).holdings[0]).toMatchObject({ units: '5', averageCost: '1.6', returnRate: '87.5' })
    expect(summary(source).totals[0]).toMatchObject({ cost: '8', marketValue: '15', unrealizedPnl: '7', returnRate: '87.5' })
    const free = { ...source, transactions: [{ ...source.transactions[0], postings: [{ ...source.transactions[0].postings[0], cost: { amount: '0', currency: 'CNY' } }] }] }
    expect(summary(free).totals[0]).toMatchObject({ cost: '0', returnRate: null })
  })
})

describe('investment names from the ledger', () => {
  it('prefers explicit account names and only uses directly adjacent fund comments as a fallback', () => {
    const source: Ledger = { ...ledger, files: [{ path: 'accounts.bean', content: '; 示例基金C 123456\n2026-01-01 open Assets:Broker FUND\n; unrelated text\n2026-01-01 open Assets:Other CNY' }] }
    expect(investmentLabels(source).get('Assets:Broker')).toBe('示例基金C 123456')
    expect(investmentLabels(source).has('Assets:Other')).toBe(false)
    expect(investmentLabels({ ...source, accounts: [{ ...source.accounts[0], label: '我的基金' }] }).get('Assets:Broker')).toBe('我的基金')
  })
})
