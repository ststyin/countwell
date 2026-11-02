import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CloudGate from '../src/components/CloudGate'

describe('private ledger entry', () => {
  it('does not render private children before the login check completes', () => {
    const html = renderToStaticMarkup(<CloudGate><div>Private ledger sentinel</div></CloudGate>)
    expect(html).toContain('登录账本')
    expect(html).toContain('正在连接')
    expect(html).not.toContain('Private ledger sentinel')
  })
})
