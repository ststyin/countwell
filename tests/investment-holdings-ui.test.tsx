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
  it('shows total shares beside the lot heading and the three metrics for each lot', () => {
    const html = render()
    const section = html.slice(html.indexOf('class="panel investment-panel"'))
    const summary = section.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ''
    expect(summary).toContain('FUND')
    expect(summary).toContain('12.00')
    expect(summary).not.toContain('买入成本')
    expect(section).not.toContain('持有份额')
    const details = section.slice(section.indexOf('investment-item-detail'))
    expect(details.match(/<div class="holding-lots-heading">(.*?)<\/div>/)?.[1]).toContain('4.00 份')
    const lotMetrics = details.match(/<dl class="holding-lot-metrics">(.*?)<\/dl>/)?.[1] ?? ''
    expect([...lotMetrics.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1])).toEqual(['单价', '成本', '份额'])
    expect(details).toContain('1.2345')
    expect(details).toContain('2.3456')
    expect(details).toContain('3.00 份')
    expect(details).toContain('1.00 份')
    expect(details.indexOf('2026-10-02')).toBeLessThan(details.indexOf('2026-10-01'))
  })

  it('rounds displayed shares to four decimals without changing ledger precision', () => {
    const source = { ...ledger, transactions: [transaction('2026-10-01', 'fractional', lot('1234.123456789', '1.2345', '2026-10-01'))] }
    const html = render(false, source)
    expect(html).toContain('1,234.1235 份')
    expect(html).not.toContain('1234.123456789')
    expect(source.transactions[0].postings[0].amount).toBe('1234.123456789')
  })

  it('hides cost, gain, share count and unit purchase price in privacy mode', () => {
    const html = render(true)
    expect(html).toContain('金额已隐藏')
    for (const value of ['8.27', '1.2345', '2.3456', '3.00 份', '1.00 份', 'income-tone', 'expense-tone']) expect(html).not.toContain(value)
  })

  it('uses ledger fund names, keeps quote dates visible and limits the initial lot list', () => {
    const source: Ledger = { ...ledger,
      files: [{ path: 'accounts.bean', content: '; 示例科技基金C 123456\n2026-01-01 open Assets:Investment:Fund FUND' }],
      transactions: Array.from({ length: 8 }, (_, index) => transaction(`2026-10-${String(index + 1).padStart(2, '0')}`, `lot-${index}`, lot('1.123456', '1.234567', `2026-10-${String(index + 1).padStart(2, '0')}`))),
    }
    const html = render(false, source)
    expect(html).toContain('示例科技基金C 123456')
    expect(html.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1]).toContain('2026-11-01</time>')
    expect(html).toContain('8.9876 份')
    expect(html).toContain('1.2346')
    expect(html.match(/class="holding-lot"/g)).toHaveLength(5)
    expect(html).toContain('查看全部 8 个批次')
    expect(html).not.toContain('1.123456')
    expect(html).not.toContain('1.234567')
  })

  it('places zero-balance accounts after holdings without pretending their gains are known', () => {
    const account: LedgerAccount = { name: 'Assets:Investment:Closed', label: 'Closed', kind: 'asset', role: 'investment' }
    const source: Ledger = { ...ledger, accounts: [...accounts, account], transactions: [...ledger.transactions, transaction('2026-10-01', 'closed', { account: account.name, currency: 'CNY', amount: '0' })] }
    const html = render(false, source)
    expect(html).toContain('零余额与未持仓账户')
    const zeroAccounts = html.slice(html.indexOf('class="investment-history"'))
    expect(zeroAccounts).toContain('Closed')
    expect(zeroAccounts).toContain('0.00')
    expect(html.indexOf('holding-item')).toBeLessThan(html.indexOf('investment-history'))
  })

  it('keeps cumulative loss visible without separate realized and unrealized results', () => {
    const source: Ledger = { ...ledger, prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '12', currency: 'CNY' }], transactions: [
      { ...transaction('2026-10-01', 'expensive', lot('10', '20', '2026-10-01')), postings: [lot('10', '20', '2026-10-01'), { account: 'Assets:Bank', amount: '-200', currency: 'CNY' }] },
      { ...transaction('2026-10-02', 'cheap', lot('10', '10', '2026-10-02')), postings: [lot('10', '10', '2026-10-02'), { account: 'Assets:Bank', amount: '-100', currency: 'CNY' }] },
      { ...transaction('2026-10-03', 'sale', lot('-10', '20', '2026-10-01')), postings: [lot('-10', '20', '2026-10-01'), { account: 'Assets:Bank', amount: '120', currency: 'CNY' }, { account: 'Income:Gains', amount: '80', currency: 'CNY' }] },
    ] }
    const html = render(false, source)
    const summary = html.slice(html.indexOf('class="panel investment-panel"')).match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ''
    for (const value of ['累计盈亏', '-60.00', '-20.00%']) expect(summary).toContain(value)
    for (const value of ['已实现盈亏', '持仓浮动盈亏', '持仓盈亏']) expect(html).not.toContain(value)
    const details = html.slice(html.indexOf('investment-item-detail'))
    for (const value of ['累计投入', '卖出净收回', '净投入']) expect(details).not.toContain(value)
    const quotes = details.slice(details.indexOf('holding-quote-grid'), details.indexOf('holding-lots-heading'))
    expect([...quotes.matchAll(/<div><span>(.*?)<\/span>/g)].map(match => match[1])).toEqual(['回本参考净值', '平均持仓单价', '最新净值'])
    expect(quotes).toContain('18.0000')
    const hidden = render(true, source)
    for (const value of ['-60.00', '18.0000', '-20.00%', 'income-tone', 'expense-tone']) expect(hidden).not.toContain(value)
  })

  it('does not color or sign sub-cent rounding residue as a gain or loss', () => {
    const source: Ledger = { ...ledger, prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '1', currency: 'CNY' }], transactions: [{
      ...transaction('2026-10-01', 'precise', lot('2', '1.00000000000000000001', '2026-10-01')),
      postings: [lot('2', '1.00000000000000000001', '2026-10-01'), { account: 'Assets:Bank', amount: '-2', currency: 'CNY' }],
    }] }
    const html = render(false, source)
    for (const value of ['-0.00', '+0.00', 'income-tone', 'expense-tone']) expect(html).not.toContain(value)
  })

  it('keeps lot costs visible if the market price is missing', () => {
    const missing = render(false, { ...ledger, prices: [] })
    const missingSummary = missing.slice(missing.indexOf('class="panel investment-panel"')).match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? ''
    expect(missingSummary).toContain('缺少报价')
    expect(missingSummary).toContain('—')
    expect(missing).toContain('<dt>成本</dt>')
    expect(missing).toContain('7.04')
  })
})
