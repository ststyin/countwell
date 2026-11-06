import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { parseDemoLedger } from '../../src/domain/parser'
import type { ExpenseStatus } from '../../src/recording/expense'

const ledger = parseDemoLedger('2026-01-01 open Assets:Bank\n2026-01-01 open Expenses:Food\n')
const status = {
  configured: true, connected: true, loading: false, lastError: null, snapshotId: 'fixture',
  source: { type: 'github', repository: 'example/ledger', entryPath: 'main.beancount' },
}

async function setupRecording(page: Page, initialStatus: ExpenseStatus, loseResponse = false) {
  let outcome = initialStatus
  const writes: string[] = []
  const queries: string[] = []
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    switch (url.pathname) {
      case '/api/auth/status': return route.fulfill({ json: { cloud: true, configured: true, authenticated: true } })
      case '/api/session': return route.fulfill({ json: { csrf: 'fixture-token' } })
      case '/api/ledger/snapshot': return route.fulfill({ json: { ledger, status } })
      case '/api/ledger/status': return route.fulfill({ json: status })
      case '/api/expenses': {
        const { id } = request.postDataJSON() as { id: string }
        writes.push(id)
        // Simulate a lost response after the write request reached the server.
        return loseResponse ? route.abort('connectionreset') : route.fulfill({ status: 202, json: { id } })
      }
      case '/api/expenses/status': {
        queries.push(url.searchParams.get('id') ?? '')
        const legacyStatus = outcome === 'failed' ? 'failed' : outcome === 'pending' ? 'pending' : 'success'
        return route.fulfill({ json: { status: legacyStatus, state: outcome } })
      }
      default: return route.fulfill({ status: 404 })
    }
  })

  await page.goto('/#/record')
  return { writes, queries, setOutcome(next: ExpenseStatus) { outcome = next } }
}

async function fillExpense(page: Page) {
  await page.getByRole('textbox', { name: '支出金额' }).fill('12.34')
  await page.getByLabel('支付方式').selectOption('Assets:Bank')
  await page.getByLabel('支出分类').selectOption('Expenses:Food')
  await page.getByLabel('交易方式').fill('刷卡')
  await page.getByLabel('描述', { exact: true }).fill('测试支出')
}

test('recovers a submitted expense on reload and separates publication failure from writing', async ({ page }) => {
  const { writes, queries, setOutcome } = await setupRecording(page, 'pending', true)
  await fillExpense(page)
  await page.getByRole('button', { name: '保存并提交' }).click()
  await expect.poll(() => writes.length).toBe(1)

  await page.reload()
  await expect(page.getByText('正在校验并提交账本…')).toBeVisible()
  await expect.poll(() => queries.at(-1)).toBe(writes[0])

  setOutcome('publish_failed')
  await expect(page.getByRole('heading', { name: '已入账，网站更新失败' })).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('button', { name: '再记一笔' })).toBeVisible()
  expect(writes).toHaveLength(1)

  await page.getByRole('button', { name: '再记一笔' }).click()
  await expect(page.getByRole('textbox', { name: '支出金额' })).toBeEmpty()
})

test('retries a canceled write with the same request ID after reloading', async ({ page }) => {
  const { writes, queries, setOutcome } = await setupRecording(page, 'failed')
  await fillExpense(page)
  await page.getByRole('button', { name: '保存并提交' }).click()
  await expect(page.getByRole('heading', { name: '未能入账' })).toBeVisible()

  const saved = await page.evaluate(() => Object.values(sessionStorage))
  expect(saved).toEqual([writes[0]])
  await page.reload()
  await page.getByRole('button', { name: '重新填写同一笔支出' }).click()
  await fillExpense(page)
  await page.getByRole('button', { name: '重试同一笔支出' }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toBe(writes[0])
  expect(queries.every(id => id === writes[0])).toBe(true)

  await expect(page.getByRole('button', { name: '查询提交状态' })).toBeVisible()
  setOutcome('published')
  await page.getByRole('button', { name: '查询提交状态' }).click()
  await expect(page.getByRole('heading', { name: '记账成功' })).toBeVisible()
})
