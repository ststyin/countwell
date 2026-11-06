import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { updateFundNav } from '../scripts/update-fund-nav'

it('appends only official unit NAVs for funds held on the check date', async () => {
  const root = await mkdtemp(join(tmpdir(), 'countwell-fund-nav-'))
  const original = '2026-11-04 price HELD 1.0000 CNY\n'
  const prices = join(root, 'investments/prices.beancount')
  const url = 'https://www.efunds.com.cn/fund/000001.shtml'
  try {
    await mkdir(join(root, 'investments'))
    await writeFile(prices, original)
    await writeFile(join(root, 'main.beancount'), `
include "investments/prices.beancount"
2026-01-01 open Assets:Bank CNY
; 易方达持有基金 000001
2026-01-01 open Assets:Fund:Held HELD
; 易方达已卖出基金 000002
2026-01-01 open Assets:Fund:Sold SOLD
2026-11-01 * "Buy"
  Assets:Fund:Held 10 HELD {1 CNY}
  Assets:Fund:Sold 10 SOLD {1 CNY}
  Assets:Bank -20 CNY
2026-11-02 * "Sell"
  Assets:Fund:Sold -10 SOLD {1 CNY}
  Assets:Bank 10 CNY
2026-11-07 * "Future sale"
  Assets:Fund:Held -10 HELD {1 CNY}
  Assets:Bank 10 CNY
`)
    const seen: string[] = []
    let amount = '1.2345'
    let date = '2026-11-05'
    const fetchPage = async (requested: string) => {
      seen.push(requested)
      return `<li data-id="000001" class="on">C</li>
<div id="net-today">${amount}</div><div class="fund-s-msg">单位净值(元)</div>
<div id="net-totsl">2.2222</div><div class="fund-s-msg">累计净值(元)</div>
基金净值日期：<span class="nav-update">${date}</span>`
    }
    const run = () => updateFundNav(root, 'main.beancount', { today: '2026-11-06', fetchPage })
    expect(await run()).toEqual({ updates: [{ commodity: 'HELD', date: '2026-11-05', amount: '1.2345' }], issues: [], checked: 1 })
    expect(seen).toEqual([url])
    const updated = original + '\n2026-11-05 price HELD 1.2345 CNY\n'
    expect(await readFile(prices, 'utf8')).toBe(updated)
    expect(await run()).toEqual({ updates: [], issues: [], checked: 1 })

    amount = '1.2400'
    expect((await run()).issues[0]).toContain('保留原值')
    date = '2026-11-07'
    expect(await run()).toMatchObject({ updates: [], checked: 0 })
    expect(await readFile(prices, 'utf8')).toBe(updated)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
