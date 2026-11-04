import { isValidElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ expanded: null as 'income' | 'expense' | null }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useContext: () => ({ hidden: false, currency: 'CNY' }),
  useState: () => [state.expanded, (next: (current: typeof state.expanded) => typeof state.expanded) => { state.expanded = next(state.expanded) }],
}))

import { parseDemoLedger } from '../src/domain'
import OverviewPage, { AccountFlowPanel } from '../src/pages/OverviewPage'

const ledger = parseDemoLedger(`
2026-01-01 open Assets:Bank
2026-01-01 open Income:Salary
2026-01-01 open Expenses:Food
2026-11-01 * "Salary"
  Assets:Bank 100 CNY
  Income:Salary -100 CNY
2026-11-02 * "Food"
  Expenses:Food 20 CNY
  Assets:Bank -20 CNY
`)

type Props = { children?: unknown; onClick?: () => void; 'aria-expanded'?: boolean; mode?: string }
function descendants(node: unknown): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!isValidElement<Props>(node)) return []
  return [node, ...descendants(node.props.children)]
}

describe('overview account expansion', () => {
  beforeEach(() => { state.expanded = null })
  it('opens and switches account panels without navigating, and closes the selected panel', () => {
    const navigate = vi.fn()
    const render = () => descendants(OverviewPage({ ledger, month: '2026-11', currency: 'CNY', onNavigate: navigate }))
    let elements = render()
    const flowButtons = () => elements.filter(element => element.type === 'button' && element.props['aria-expanded'] !== undefined)
    expect(flowButtons().map(button => button.props['aria-expanded'])).toEqual([false, false])
    expect(elements.some(element => element.type === AccountFlowPanel)).toBe(false)
    flowButtons()[1].props.onClick!()
    elements = render()
    expect(flowButtons().map(button => button.props['aria-expanded'])).toEqual([false, true])
    expect(elements.find(element => element.type === AccountFlowPanel)?.props.mode).toBe('expense')
    flowButtons()[0].props.onClick!()
    elements = render()
    expect(flowButtons().map(button => button.props['aria-expanded'])).toEqual([true, false])
    expect(elements.find(element => element.type === AccountFlowPanel)?.props.mode).toBe('income')
    flowButtons()[0].props.onClick!()
    elements = render()
    expect(elements.some(element => element.type === AccountFlowPanel)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})
