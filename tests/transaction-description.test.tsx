import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TransactionList from '../src/components/TransactionList'
import { getTransactions, parseDemoLedger } from '../src/domain'

const ledger = parseDemoLedger(`
2026-01-01 open Assets:Card
2026-01-01 open Expenses:Food
2026-10-01 * "示例信用卡" "示例商店"
  Expenses:Food 15 CNY
  Assets:Card -15 CNY
2026-10-02 * "只有描述"
  Expenses:Food 20 CNY
  Assets:Card -20 CNY
2026-10-03 * "相同内容" "相同内容"
  Expenses:Food 25 CNY
  Assets:Card -25 CNY
`)

function renderTransaction(narration: string, overrides: { payee?: string; narration?: string } = {}) {
  const transaction = getTransactions(ledger, { month: '2026-10' }).find(item => item.narration === narration)!
  return renderToStaticMarkup(<TransactionList transactions={[{ ...transaction, ...overrides }]} />)
}

describe('transaction list description', () => {
  it('shows only the description in the summary and payment name in the details', () => {
    const html = renderTransaction('示例商店')
    const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'))
    const details = html.slice(html.indexOf('class="transaction-detail-header"'))
    expect(summary).toContain('示例商店')
    expect(summary).not.toContain('示例信用卡')
    expect(details).toContain('<span>示例信用卡</span>')
  })
  it('handles a missing payment name or description without inventing either', () => {
    const noPayee = renderTransaction('只有描述')
    expect(noPayee).toContain('<span>未填写</span>')
    const noNarration = renderTransaction('示例商店', { narration: '' })
    expect(noNarration.slice(noNarration.indexOf('<summary>'), noNarration.indexOf('</summary>'))).toContain('无描述交易')
    expect(noNarration).toContain('<span>示例信用卡</span>')
  })
})
