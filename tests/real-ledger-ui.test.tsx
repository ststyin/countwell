import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import OverviewPage from '../src/pages/OverviewPage'
import { DisplayContext } from '../src/components/ui'
import type { Ledger } from '../src/domain/types'

describe('official financial snapshot presentation', () => {
  it('shows unavailable monthly amounts rather than false zero totals for priced expenses', () => {
    const ledger: Ledger = {
      title: 'Synthetic priced expense', source: '', defaultMonth: '2026-10', commodities: [], prices: [],
      accountNames: ['Assets:Bank', 'Expenses:Food'],
      accounts: [{ name: 'Assets:Bank', label: 'Bank', kind: 'asset', role: 'cash' }, { name: 'Expenses:Food', label: 'Food', kind: 'expense', role: 'other' }],
      transactions: [{ id: 'priced', date: '2026-10-01', payee: 'Synthetic priced purchase', narration: 'Fixture', flag: '*', tags: [], postings: [
        { account: 'Expenses:Food', amount: '2', currency: 'ITEM', price: { amount: '10', currency: 'CNY' }, weight: { amount: '20', currency: 'CNY' } },
        { account: 'Assets:Bank', amount: '-20', currency: 'CNY' },
      ] }],
    }
    const html = renderToStaticMarkup(<DisplayContext.Provider value={{ hidden: false, currency: 'CNY' }}><OverviewPage ledger={ledger} month="2026-10" currency="CNY" today="2026-10-01" onNavigate={() => {}} /></DisplayContext.Provider>)
    const summary = html.slice(html.indexOf('class="flow-grid"'), html.indexOf('class="payment-spending"'))
    expect(summary.match(/>—</g)).toHaveLength(3)
    expect(summary).not.toContain('0.00')
    const payment = html.slice(html.indexOf('class="payment-spending"'), html.indexOf('class="dashboard-grid"'))
    expect(payment).toContain('金额待确认')
    expect(payment).not.toContain('20.00')
    expect(html).toContain('本月收支暂不可汇总')
    expect(html).toContain('分类合计暂不可用')
    expect(html).toContain('Synthetic priced purchase')
    expect(html).not.toContain('class="trend-chart"')
  })
})
