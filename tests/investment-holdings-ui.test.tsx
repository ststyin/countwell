import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DisplayContext } from '../src/components/ui'
import type { Ledger, LedgerAccount, LedgerTransaction, Posting } from '../src/domain/types'
import AccountsPage from '../src/pages/AccountsPage'

const accounts: LedgerAccount[] = [
  { name: 'Assets:Investment:Fund', label: 'Fund', kind: 'asset', role: 'investment' },
  { name: 'Assets:Bank', label: 'Bank', kind: 'asset', role: 'cash' },
]
const lot = (amount: string, price: string, date: string): Posting => ({ account: 'Assets:Investment:Fund', amount, currency: 'FUND', cost: { amount: price, currency: 'CNY', date } })
const transaction = (date: string, id: string, posting: Posting): LedgerTransaction => ({ id, date, payee: '', narration: id, flag: '*', tags: [], postings: [posting] })
const ledger: Ledger = {
  title: 'Synthetic holdings', source: '', defaultMonth: '2026-11', accounts, accountNames: accounts.map(account => account.name),
  commodities: [], operatingCurrencies: ['CNY'], prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '3', currency: 'CNY' }],
  transactions: [
    transaction('2026-10-01', 'first', lot('2', '1.2345', '2026-10-01')),
    transaction('2026-10-02', 'second', lot('3', '2.3456', '2026-10-02')),
    transaction('2026-10-03', 'sold', lot('-1', '1.2345', '2026-10-01')),
  ],
}

function render(hidden = false, source = ledger) {
  return renderToStaticMarkup(<DisplayContext.Provider value={{ hidden, currency: 'CNY' }}><AccountsPage ledger={source} currency="CNY" onAccount={() => {}} /></DisplayContext.Provider>)
}

describe('investment holding presentation', () => {
  it('shows remaining cost and profit while collapsed, and exact purchase prices in newest-first lots', () => {
    const html = render()
    const section = html.slice(html.indexOf('class="panel investment-panel"'))
    const summary = section.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ''
    expect(summary).toContain('FUND')
    expect(summary).toContain('12.00')
    expect(summary).toContain('总成本')
    expect(summary).toContain('8.27')
    expect(summary).toContain('持仓盈亏')
    expect(summary).toContain('+3.73')
    const details = section.slice(section.indexOf('investment-item-detail'))
    expect(details).toContain('买入单价')
    expect(details).toContain('1.2345')
    expect(details).toContain('2.3456')
    expect(details).toContain('3 份')
    expect(details).toContain('1 份')
    expect(details.indexOf('2026-10-02')).toBeLessThan(details.indexOf('2026-10-01'))
  })

  it('hides cost, gain, share count and unit purchase price in privacy mode', () => {
    const html = render(true)
    expect(html).toContain('金额已隐藏')
    for (const value of ['8.27', '3.73', '1.2345', '2.3456', '3 份', '1 份']) expect(html).not.toContain(value)
  })

  it('shows losses and keeps cost visible if the market price is missing', () => {
    const loss = render(false, { ...ledger, prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '1', currency: 'CNY' }] })
    const lossSummary = loss.slice(loss.indexOf('class="panel investment-panel"')).match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ''
    expect(lossSummary).toContain('8.27')
    expect(lossSummary).toContain('-4.27')
    expect(lossSummary).toContain('expense-tone')
    const missing = render(false, { ...ledger, prices: [] })
    const missingSummary = missing.slice(missing.indexOf('class="panel investment-panel"')).match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ''
    expect(missingSummary).toContain('缺少报价')
    expect(missingSummary).toContain('8.27')
    expect(missingSummary).toContain('持仓盈亏')
    expect(missingSummary).toContain('—')
  })
})
