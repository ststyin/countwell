import { execFile } from 'node:child_process'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Decimal from 'decimal.js'
import { loadOfficialLedger } from '../server/engine'
import { getAccounts } from '../src/domain/reports'
import type { Ledger } from '../src/domain/types'

const pricesPath = 'investments/prices.beancount'
const exec = promisify(execFile)
const providers = ['申万菱信', '博时', '德邦', '易方达'] as const
type Provider = typeof providers[number]
type Fund = { commodity: string; code: string; provider: Provider }
type Quote = { date: string; amount: string }

function quoteUrl({ provider, code }: Fund) {
  switch (provider) {
    case '申万菱信': return 'https://www.swsmu.com/fundproject/index.html'
    case '博时': return `https://www.bosera.com/fund/${code}.html`
    case '德邦': return 'https://www.dbfund.com.cn/products/index.html'
    case '易方达': return `https://www.efunds.com.cn/fund/${code}.shtml`
  }
}

function onlyMatch(html: string, pattern: RegExp) {
  const matches = [...html.matchAll(pattern)]
  return matches.length === 1 ? matches[0] : undefined
}

function cells(html: string, element: 'td' | 'th') {
  return [...html.matchAll(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`, 'gi'))]
    .map(match => match[1].replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim())
}

function tableQuote(html: string, code: string, provider: '申万菱信' | '德邦') {
  const row = onlyMatch(html, new RegExp(`<tr\\b[^>]*\\sfundcode="${code}"[^>]*>([\\s\\S]*?)</tr>`, 'gi'))
  if (!row || row.index === undefined) return null
  const tableStart = html.lastIndexOf('<table', row.index)
  if (tableStart < 0) return null
  const headings = cells(html.slice(tableStart, row.index), 'th')
  const unitHeading = provider === '申万菱信' ? '净值' : '基金净值(元)'
  const values = cells(row[1], 'td')
  if (headings[2] !== '净值日期' || headings[3] !== unitHeading || headings[4] !== '累计净值') return null
  if (provider === '申万菱信' ? values[0] !== code : !new RegExp(`\\b${code}\\s*\\|`).test(values[0] ?? '')) return null
  return { date: values[2], amount: values[3] }
}

function extractQuote(html: string, { provider, code }: Fund): Quote | null {
  if (provider === '申万菱信' || provider === '德邦') return tableQuote(html, code, provider)
  if (provider === '博时') {
    if (!html.includes(`name="keywords" content="${code},`)) return null
    const headline = onlyMatch(html, /<div class="fund-essential_return">\s*<span class="num">\s*([^<]+)[\s\S]*?<span class="text">单位净值\s*\/\s*日涨幅\s*\(([^)]+)\)<\/span>/g)
    return headline ? { date: headline[2].trim(), amount: headline[1].trim() } : null
  }
  if (!html.includes(`data-id="${code}" class="on"`)) return null
  const amount = onlyMatch(html, /<div\b[^>]*\bid="net-today"[^>]*>([^<]+)<\/div>\s*<div class="fund-s-msg">单位净值\(元\)<\/div>/g)
  const date = onlyMatch(html, /基金净值日期：\s*<span class="nav-update">([^<]+)<\/span>/g)
  return amount && date ? { date: date[1].trim(), amount: amount[1].trim() } : null
}

function validQuote(quote: Quote | null, today: string): quote is Quote {
  if (!quote || !/^\d{4}-\d{2}-\d{2}$/.test(quote.date) || quote.date > today) return false
  const date = new Date(quote.date + 'T00:00:00Z')
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === quote.date
    && /^(?:0|[1-9]\d{0,4})\.\d{1,8}$/.test(quote.amount) && new Decimal(quote.amount).gt(0)
}

function heldFunds(ledger: Ledger, today: string) {
  const declarations = new Map<string, Fund>()
  for (const file of ledger.files ?? []) {
    const lines = file.content.split(/\r?\n/)
    for (let i = 1; i < lines.length; i++) {
      // Require the fund code next to an account with exactly one declared commodity.
      const opening = lines[i].match(/^\d{4}-\d{2}-\d{2}\s+open\s+(\S+)\s+([A-Z][A-Z0-9._'-]*)(?:\s+"[A-Z_]+")?\s*(?:;.*)?$/)
      const comment = lines[i - 1].match(/^\s*;\s*(\S.*?)\s+[（(]?(\d{6})[）)]?(?:\s*[（(]已卖出[）)])?\s*$/)
      if (!opening || !comment) continue
      const provider = providers.find(name => comment[1].startsWith(name))
      if (provider) declarations.set(opening[1], { commodity: opening[2], code: comment[2], provider })
    }
  }
  const eligible = getAccounts({ ...ledger, transactions: ledger.transactions.filter(transaction => transaction.date <= today) }).accounts
    .filter(account => account.kind === 'asset' && account.role === 'investment' && new Decimal(account.balance).gt(0))
  const byCommodity = new Map<string, Fund>()
  const unconfigured = new Set<string>()
  for (const account of eligible) {
    const declaration = declarations.get(account.name)
    if (!declaration || declaration.commodity !== account.currency) {
      unconfigured.add(account.currency)
      continue
    }
    const previous = byCommodity.get(declaration.commodity)
    if (previous && (previous.code !== declaration.code || previous.provider !== declaration.provider)) unconfigured.add(declaration.commodity)
    byCommodity.set(declaration.commodity, declaration)
  }
  return { funds: [...byCommodity.values()].filter(fund => !unconfigured.has(fund.commodity)), unconfigured: unconfigured.size }
}

async function download(url: string) {
  const { stdout } = await exec('curl', ['-q', '-fsS', '--proto', '=https', '--max-time', '18', '--max-filesize', '2000000', url], { maxBuffer: 2_000_000 })
  return stdout
}

export async function updateFundNav(rootPath: string, entryPath: string, options: {
  today?: string
  fetchPage?: (url: string) => Promise<string>
} = {}) {
  if (entryPath !== 'main.beancount') throw new Error('只支持根目录 main.beancount。')
  const root = await realpath(rootPath)
  const entry = resolve(root, entryPath)
  const target = resolve(root, pricesPath)
  if (!(await lstat(target)).isFile() || await realpath(target) !== target) throw new Error('报价文件必须是账本内的普通文件。')
  const ledger = await loadOfficialLedger(entry, { sourceRoot: root })
  if (!ledger.files.some(file => file.path === pricesPath)) throw new Error('报价文件没有被账本包含。')
  const today = options.today ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date())
  const { funds, unconfigured } = heldFunds(ledger, today)
  const pages = new Map<string, Promise<string>>()
  const quotes = await Promise.allSettled(funds.map(async fund => {
    const url = quoteUrl(fund)
    const page = pages.get(url) ?? (options.fetchPage ?? download)(url)
    pages.set(url, page)
    const quote = extractQuote(await page, fund)
    if (!validQuote(quote, today)) throw new Error('官网没有可确认的单位净值。')
    return { fund, quote }
  }))
  const updates: (Quote & { commodity: string })[] = []
  const issues: string[] = unconfigured ? [`${unconfigured} 个在持标的缺少可确认的官网映射。`] : []
  let checked = 0
  for (let i = 0; i < funds.length; i++) {
    const result = quotes[i]
    const fund = funds[i]
    if (result.status === 'rejected') {
      issues.push(`${fund.code} 官网净值查询未能确认。`)
      continue
    }
    checked++
    const { quote } = result.value
    const existing = ledger.prices.filter(price => price.commodity === fund.commodity && price.currency === 'CNY')
    const sameDay = existing.filter(price => price.date === quote.date)
    if (sameDay.some(price => !new Decimal(price.amount).eq(quote.amount))) issues.push(`${fund.code} ${quote.date} 的同日报价与账本不同，保留原值。`)
    if (existing.some(price => price.date >= quote.date)) continue
    updates.push({ ...quote, commodity: fund.commodity })
  }
  if (!updates.length) return { updates, issues, checked }

  const previous = await readFile(target, 'utf8')
  const newline = previous.includes('\r\n') ? '\r\n' : '\n'
  const directives = updates.sort((a, b) => a.date.localeCompare(b.date) || a.commodity.localeCompare(b.commodity))
    .map(quote => `${quote.date} price ${quote.commodity} ${quote.amount} CNY`)
  const separator = previous.endsWith(newline) ? newline : newline + newline
  await writeFile(target, previous + separator + directives.join(newline) + newline, 'utf8')
  try {
    const candidate = await loadOfficialLedger(entry, { sourceRoot: root })
    for (const quote of updates) {
      if (!candidate.prices.some(price => price.date === quote.date && price.commodity === quote.commodity && price.currency === 'CNY' && new Decimal(price.amount).eq(quote.amount))) {
        throw new Error('新增净值未出现在校验结果中。')
      }
    }
  } catch (error) {
    await writeFile(target, previous, 'utf8')
    throw error
  }
  return { updates, issues, checked }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await updateFundNav(process.env.COUNTWELL_LEDGER_DIR ?? '', process.env.COUNTWELL_LEDGER_ENTRY ?? '')
    for (const issue of result.issues) console.log(`::warning::${issue}`)
    console.log(`已核对 ${result.checked} 个标的，新增 ${result.updates.length} 条单位净值。`)
    if (!result.checked && result.issues.length) process.exitCode = 1
  } catch {
    console.error('基金净值更新未通过账本校验。')
    process.exitCode = 1
  }
}
