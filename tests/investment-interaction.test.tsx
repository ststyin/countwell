import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ledger } from '../src/domain/types'

const state = vi.hoisted(() => ({ expanded: false }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useContext: () => ({ hidden: false, currency: 'CNY' }),
  useState: () => [state.expanded, (next: boolean) => { state.expanded = next }],
}))
import InvestmentPanel from '../src/components/InvestmentPanel'
import { getAccounts, summarizeInvestments } from '../src/domain/reports'

type Props = { children?: unknown; onClick?: () => void; 'aria-expanded'?: boolean; holding?: unknown }
function descendants(node: unknown): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!isValidElement<Props>(node)) return []
  return [node, ...descendants(node.props.children)]
}
const ledger: Ledger = {
  title: 'Synthetic lots', source: '', defaultMonth: '2026-11', accountNames: ['Assets:Fund'],
  accounts: [{ name: 'Assets:Fund', label: 'Fund', role: 'investment', kind: 'asset' }], commodities: ['FUND'],
  prices: [{ date: '2026-11-01', commodity: 'FUND', amount: '2', currency: 'CNY' }],
  transactions: Array.from({ length: 8 }, (_, index) => ({
    id: `lot-${index}`, date: `2026-10-0${index + 1}`, payee: '', narration: '', tags: [], flag: '*',
    postings: [{ account: 'Assets:Fund', amount: '1', currency: 'FUND', cost: { amount: '1', currency: 'CNY', date: `2026-10-0${index + 1}` } }],
  })),
}

describe('investment lot disclosure', () => {
  beforeEach(() => { state.expanded = false })
  it('expands all remaining lots, collapses again, and opens the correct account', () => {
    const onAccount = vi.fn()
    const panel = InvestmentPanel({ ledger, summary: summarizeInvestments(ledger, getAccounts(ledger), 'CNY'), currency: 'CNY', emptyAccounts: [], onAccount })
    const holding = descendants(panel).find(element => element.props.holding)!
    const render = () => (holding.type as (props: Props) => ReactElement)(holding.props)
    let tree = render()
    expect(renderToStaticMarkup(tree).match(/class="holding-lot"/g)).toHaveLength(5)
    descendants(tree).find(element => element.props['aria-expanded'] === false)!.props.onClick!()
    tree = render()
    expect(renderToStaticMarkup(tree).match(/class="holding-lot"/g)).toHaveLength(8)
    expect(renderToStaticMarkup(tree)).toContain('2026-10-01')
    descendants(tree).find(element => element.props['aria-expanded'] === true)!.props.onClick!()
    tree = render()
    expect(renderToStaticMarkup(tree).match(/class="holding-lot"/g)).toHaveLength(5)
    descendants(tree).filter(element => element.type === 'button').at(-1)!.props.onClick!()
    expect(onAccount).toHaveBeenCalledExactlyOnceWith('Assets:Fund')
  })
})
