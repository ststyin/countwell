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

function titleFor(narration: string) {
  const transaction = getTransactions(ledger, { month: '2026-10' }).find(item => item.narration === narration)!
  const html = renderToStaticMarkup(<TransactionList transactions={[transaction]} />)
  return html.match(/<span class="transaction-title">(.*?)<span class="transaction-kind">/)?.[1]
}

describe('transaction list description', () => {
  it('shows the description after the payment name in the collapsed row', () => {
    expect(titleFor('示例商店')).toContain('示例信用卡<span class="transaction-narration">· 示例商店</span>')
  })
  it('avoids duplicating the description when the payment name is absent or identical', () => {
    expect(titleFor('只有描述')).toBe('只有描述')
    expect(titleFor('相同内容')).toBe('相同内容')
  })
})
