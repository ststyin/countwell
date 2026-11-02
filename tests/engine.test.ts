import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadOfficialLedger, OfficialLedgerError } from '../server/engine'

const pythonPath = process.env.COUNTWELL_PYTHON
  ?? (existsSync(resolve('.venv/bin/python')) ? resolve('.venv/bin/python') : 'python3')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function tree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'countwell-engine-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    const destination = join(root, path)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, text)
  }
  return root
}

const accounts = `
2000-01-01 open Assets:Bank
  display_name: "银行卡"
2000-01-01 open Assets:Broker
2000-01-01 open Equity:Opening
2000-01-01 open Income:Salary
2000-01-01 open Expenses:Food
`

describe('official Beancount engine bridge', () => {
  it('loads nested, sibling and glob includes with official amount interpolation', async () => {
    const root = await tree({
      'ledger/main.beancount': 'option "title" "Real fixture"\ninclude "../accounts/*.bean"\ninclude "../years/2026/index.bean"\n',
      'accounts/accounts.bean': accounts,
      'years/2026/index.bean': 'include "months/*.bean"\n',
      'years/2026/months/oct.bean': '2026-10-25 * "Employer" "Salary" #work ^salary\n  Assets:Bank 10000 CNY\n  Income:Salary\n',
    })
    const entry = join(root, 'ledger/main.beancount')
    const before = await readFile(entry, 'utf8')
    const ledger = await loadOfficialLedger(entry, { pythonPath })
    expect(ledger.engine).toMatchObject({ name: 'beancount', version: expect.stringMatching(/^3\./) })
    expect(ledger.title).toBe('Real fixture')
    expect(ledger.transactions[0]).toMatchObject({ date: '2026-10-25', payee: 'Employer', narration: 'Salary', flag: '*', tags: ['work'], links: ['salary'] })
    expect(ledger.transactions[0].postings[1]).toMatchObject({ amount: '-10000', currency: 'CNY', weight: { amount: '-10000', currency: 'CNY' } })
    expect(ledger.files.map(file => file.path).sort()).toEqual(['accounts/accounts.bean', 'ledger/main.beancount', 'years/2026/index.bean', 'years/2026/months/oct.bean'])
    expect(ledger.accounts.find(account => account.name === 'Assets:Bank')?.label).toBe('银行卡')
    expect(await readFile(entry, 'utf8')).toBe(before)
    expect(JSON.stringify(ledger)).not.toContain(root)
  })

  it('supports local absolute includes while enforcing an explicit remote source root', async () => {
    const root = await tree({ 'source/main.bean': '', 'external/accounts.bean': accounts })
    const entry = join(root, 'source/main.bean')
    await writeFile(entry, `include ${JSON.stringify(join(root, 'external/accounts.bean'))}\n`)
    expect((await loadOfficialLedger(entry, { pythonPath })).accounts).toHaveLength(5)
    await expect(loadOfficialLedger(entry, { pythonPath, sourceRoot: join(root, 'source') })).rejects.toMatchObject({ code: 'OUTSIDE_SOURCE_ROOT' })
  })

  it('respects the official raw processing mode while retaining booking and final validation', async () => {
    const root = await tree({ 'main.bean': 'option "plugin_processing_mode" "raw"\n' + accounts + '\n2026-10-01 * "Raw fixture"\n  Assets:Bank 2 CNY\n  Income:Salary\n' })
    const ledger = await loadOfficialLedger(join(root, 'main.bean'), { pythonPath })
    expect(ledger.transactions[0].postings[1].amount).toBe('-2')
  })

  it('refuses balances, duplicate includes and missing globs without returning partial data', async () => {
    const root = await tree({
      'balance.bean': accounts + '\n2026-10-01 * "Deposit"\n  Assets:Bank 10 CNY\n  Equity:Opening -10 CNY\n2026-10-02 balance Assets:Bank 11 CNY\n',
      'accounts.bean': accounts,
      'duplicate.bean': 'include "accounts.bean"\ninclude "accounts.bean"\n',
      'missing.bean': 'include "missing/*.bean"\n',
    })
    for (const name of ['balance.bean', 'duplicate.bean', 'missing.bean']) {
      const failure = await loadOfficialLedger(join(root, name), { pythonPath }).catch(error => error)
      expect(failure).toBeInstanceOf(OfficialLedgerError)
      expect(failure.code).toBe('LEDGER_INVALID')
      expect(failure.diagnostics.length).toBeGreaterThan(0)
      expect(JSON.stringify(failure)).not.toContain(root)
    }
    const balanceFailure = await loadOfficialLedger(join(root, 'balance.bean'), { pythonPath }).catch(error => error)
    expect(balanceFailure.diagnostics).toContainEqual(expect.objectContaining({ file: 'balance.bean', line: expect.any(Number), message: expect.stringContaining('余额断言') }))
  })

  it('preserves official FIFO booked lots, normalized costs, sale prices and weights', async () => {
    const root = await tree({ 'main.bean': accounts.replace('open Assets:Broker', 'open Assets:Broker "FIFO"') + `
2026-09-01 * "First lot"
  Assets:Broker 2 STOCK {10 USD, 2026-09-01, "first"}
  Assets:Bank -20 USD
2026-09-02 * "Second lot"
  Assets:Broker 3 STOCK {12 USD, 2026-09-02, "second"}
  Assets:Bank -36 USD
2026-10-01 * "Sale"
  Assets:Broker -4 STOCK {} @ 15 USD
  Assets:Bank 60 USD
  Income:Salary -16 USD
` })
    const ledger = await loadOfficialLedger(join(root, 'main.bean'), { pythonPath })
    const sale = ledger.transactions.find(transaction => transaction.narration === 'Sale')!
    const postings = sale.postings.filter(posting => posting.account === 'Assets:Broker')
    expect(postings).toHaveLength(2)
    expect(postings).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: '-2', cost: { amount: '10', currency: 'USD', date: '2026-09-01', label: 'first' }, price: { amount: '15', currency: 'USD' }, weight: { amount: '-20', currency: 'USD' } }),
      expect.objectContaining({ amount: '-2', cost: { amount: '12', currency: 'USD', date: '2026-09-02', label: 'second' }, weight: { amount: '-24', currency: 'USD' } }),
    ]))
  })

  it('preserves multi-currency transactions and custom account roots', async () => {
    const root = await tree({ 'main.bean': `option "name_assets" "Actif"
option "name_liabilities" "Passif"
option "name_income" "Revenu"
option "name_expenses" "Depense"
option "name_equity" "Capital"
option "operating_currency" "CNY"
option "operating_currency" "USD"
2000-01-01 open Actif:Bank
2000-01-01 open Revenu:Salary
2026-10-01 * "Two currencies"
  Actif:Bank 10 CNY
  Revenu:Salary -10 CNY
  Actif:Bank 2 USD
  Revenu:Salary -2 USD
` })
    const ledger = await loadOfficialLedger(join(root, 'main.bean'), { pythonPath })
    expect(ledger.roots).toMatchObject({ assets: 'Actif', income: 'Revenu', expenses: 'Depense' })
    expect(ledger.operatingCurrencies).toEqual(['CNY', 'USD'])
    expect(ledger.accounts.find(account => account.name === 'Revenu:Salary')?.kind).toBe('income')
    expect(ledger.transactions[0].postings.map(posting => posting.currency)).toEqual(['CNY', 'CNY', 'USD', 'USD'])
  })

  it('never executes untrusted plugins, including declarations inside included files', async () => {
    const root = await tree({
      'main.bean': 'include "child.bean"\n' + accounts,
      'child.bean': 'plugin "test_plugin"\n',
      'test_plugin.py': 'raise RuntimeError("PLUGIN_MUST_NOT_RUN")\n',
    })
    const error = await loadOfficialLedger(join(root, 'main.bean'), { pythonPath }).catch(error => error)
    expect(error.code).toBe('PLUGIN_TRUST_REQUIRED')
    expect(error.diagnostics).toContainEqual(expect.objectContaining({ file: 'child.bean', line: 1 }))
    expect(JSON.stringify(error)).not.toContain('PLUGIN_MUST_NOT_RUN')
  })

  it('executes only explicitly trusted plugins and discards their console output', async () => {
    const root = await tree({
      'main.bean': 'option "insert_pythonpath" "TRUE"\nplugin "test_plugin"\n' + accounts + '\n2026-10-01 * "Plugin transaction"\n  Assets:Bank 1 CNY\n  Income:Salary -1 CNY\n',
      'test_plugin.py': `from pathlib import Path
from beancount.core import data
import sys
Path(__file__).with_name("ran.txt").write_text("yes")
print("PRIVATE_PLUGIN_OUTPUT")
print("PRIVATE_PLUGIN_ERROR", file=sys.stderr)
__plugins__ = ("enrich",)
def enrich(entries, options):
    return [entry._replace(tags=frozenset({"from-plugin"}), flag="PLUGIN FLAG") if isinstance(entry, data.Transaction) else entry for entry in entries], []
`,
    })
    await expect(loadOfficialLedger(join(root, 'main.bean'), { pythonPath })).rejects.toMatchObject({ code: 'PLUGIN_TRUST_REQUIRED' })
    await expect(access(join(root, 'ran.txt'))).rejects.toThrow()
    const ledger = await loadOfficialLedger(join(root, 'main.bean'), { pythonPath, allowPlugins: true })
    expect(ledger.transactions[0]).toMatchObject({ flag: 'PLUGIN FLAG', tags: ['from-plugin'] })
    expect(await readFile(join(root, 'ran.txt'), 'utf8')).toBe('yes')
    expect(JSON.stringify(ledger)).not.toContain('PRIVATE_PLUGIN_OUTPUT')
    expect(JSON.stringify(ledger)).not.toContain('PRIVATE_PLUGIN_ERROR')
  })

  it('turns plugin exits, import errors and nonfinite failures into safe load errors', async () => {
    const root = await tree({
      'main.bean': 'option "insert_pythonpath" "TRUE"\nplugin "exit_plugin"\n' + accounts,
      'exit_plugin.py': 'raise SystemExit("PRIVATE_EXIT_SECRET")\n',
    })
    const error = await loadOfficialLedger(join(root, 'main.bean'), { pythonPath, allowPlugins: true }).catch(error => error)
    expect(error).toBeInstanceOf(OfficialLedgerError)
    expect(error.code).toBe('ENGINE_LOAD_FAILED')
    expect(error.message).not.toContain('PRIVATE_EXIT_SECRET')
    expect(JSON.stringify(error)).not.toContain(root)
  })

  it('denies encrypted includes before invoking decryption and reports unavailable engines safely', async () => {
    const root = await tree({ 'main.bean': 'include "secret.gpg"\n', 'secret.gpg': 'NOT_AN_ACTUAL_ENCRYPTED_LEDGER' })
    await expect(loadOfficialLedger(join(root, 'main.bean'), { pythonPath })).rejects.toMatchObject({ code: 'ENCRYPTED_LEDGER_UNSUPPORTED' })
    await expect(loadOfficialLedger(join(root, 'main.bean'), { pythonPath: join(root, 'missing-python') })).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' })
    await expect(loadOfficialLedger('')).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' })
  })

  it('does not follow a remote include or symlink outside its materialized root', async () => {
    const root = await tree({ 'source/main.bean': 'include "../private.asc"\n', 'private.asc': 'PRIVATE_MUST_NOT_BE_READ' })
    await expect(loadOfficialLedger(join(root, 'source/main.bean'), { pythonPath, sourceRoot: join(root, 'source') })).rejects.toMatchObject({ code: 'OUTSIDE_SOURCE_ROOT' })
    await symlink('../private.asc', join(root, 'source/outside.bean'))
    await writeFile(join(root, 'source/main.bean'), 'include "outside.bean"\n')
    await expect(loadOfficialLedger(join(root, 'source/main.bean'), { pythonPath, sourceRoot: join(root, 'source') })).rejects.toMatchObject({ code: 'OUTSIDE_SOURCE_ROOT' })
  })
})
