import { afterEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createCountwellApp } from '../server/http'
import { SourceManager } from '../server/manager'
import { getOverview } from '../src/domain/reports'
import type { Ledger } from '../src/domain/types'
import type { SourceConfig } from '../src/domain/source-types'

const pythonPath = process.env.COUNTWELL_PYTHON
  ?? (existsSync(resolve('.venv/bin/python')) ? resolve('.venv/bin/python') : 'python3')
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

type JsonResponse = { status: number; headers: IncomingHttpHeaders; body: Record<string, any>; text: string }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'countwell-api-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const files: Record<string, string> = {
    'books/main.beancount': 'option "title" "API synthetic ledger"\ninclude "../accounts/*.bean"\ninclude "../years/2026/index.bean"\n',
    'accounts/open.bean': '2000-01-01 open Assets:Bank\n2000-01-01 open Income:Salary\n2000-01-01 open Expenses:Food\n',
    'years/2026/index.bean': 'include "months/*.bean"\n',
    'years/2026/months/oct.bean': '2026-10-01 * "Synthetic employer" "Salary"\n  Assets:Bank 100 CNY\n  Income:Salary\n2026-10-02 ! "Synthetic cafe" "Lunch"\n  Expenses:Food 25 CNY\n  Assets:Bank\n',
  }
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, content)
  }
  return { root, entryPath: join(root, 'books/main.beancount'), includedPath: join(root, 'years/2026/months/oct.bean'), configPath: join(root, 'private/source.json') }
}

async function serve(manager: SourceManager) {
  const app = await createCountwellApp({ manager, dev: false })
  await new Promise<void>((done, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', done) })
  cleanup.push(() => app.close())
  const port = (app.server.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`
  const send = (path: string, options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string | string[]> } = {}) => new Promise<JsonResponse>((done, reject) => {
    const content = options.body === undefined ? undefined : JSON.stringify(options.body)
    const req = request(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers: { ...(content ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content) } : {}), ...(options.token ? { 'X-Countwell-Token': options.token } : {}), ...options.headers },
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        let body: Record<string, any> = {}
        try { body = JSON.parse(text) } catch { /* Static and error bodies may be non-JSON. */ }
        done({ status: res.statusCode!, headers: res.headers, body, text })
      })
    })
    req.on('error', reject)
    req.end(content)
  })
  const session = await send('/api/session')
  expect(session.status).toBe(200)
  expect(session.body.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
  return { ...app, origin, send, token: session.body.csrf as string }
}

describe('real local HTTP financial flow', () => {
  it('never serves private runtime directories through static or development paths', async () => {
    const files = await fixture()
    const api = await serve(new SourceManager({ configPath: files.configPath, pythonPath }))
    for (const path of ['/.countwell/source.json', '/%2ecountwell/source.json', '/@fs/tmp/.countwell/source.json', '/.venv/bin/python', '/.git/config']) {
      expect((await api.send(path)).status).toBe(404)
    }
  })

  it('loads multi-directory includes, reloads changed data, preserves valid snapshots on failure, and disconnects', async () => {
    const files = await fixture()
    const manager = new SourceManager({ configPath: files.configPath, pythonPath })
    const api = await serve(manager)
    const connect = await api.send('/api/ledger/connect', { method: 'POST', token: api.token, body: { source: { type: 'local', entryPath: files.entryPath }, allowPlugins: false } })
    expect(connect.status).toBe(200)
    expect(connect.body.status).toMatchObject({ configured: true, connected: true, loading: false, fileCount: 4, transactionCount: 2, allowPlugins: false, engineVersion: expect.stringMatching(/^3\./) })
    expect(connect.body.ledger.title).toBe('API synthetic ledger')
    expect(connect.body.ledger.transactions[0].postings[1].amount).toBe('-100')
    expect(getOverview(connect.body.ledger as Ledger, '2026-10')).toMatchObject({ income: '100', expense: '25', surplus: '75' })
    expect(connect.headers['cache-control']).toContain('no-store')

    const first = await api.send('/api/ledger/snapshot', { token: api.token })
    expect(first.status).toBe(200)
    expect(first.body.status.snapshotId).toBe(connect.body.status.snapshotId)
    expect(first.body.ledger.files.map((file: { path: string }) => file.path)).toContain('years/2026/months/oct.bean')
    const initialFile = await readFile(files.includedPath, 'utf8')
    await writeFile(files.includedPath, initialFile.replace('100 CNY', '200 CNY'))
    const reloaded = await api.send('/api/ledger/reload', { method: 'POST', token: api.token })
    expect(reloaded.status).toBe(200)
    expect(reloaded.body.status.snapshotId).not.toBe(first.body.status.snapshotId)
    expect(getOverview(reloaded.body.ledger as Ledger, '2026-10')).toMatchObject({ income: '200', expense: '25', surplus: '175' })

    await writeFile(files.includedPath, initialFile + '\n2026-10-03 balance Assets:Bank 999 CNY\n')
    const failed = await api.send('/api/ledger/reload', { method: 'POST', token: api.token })
    expect(failed.status).toBe(400)
    expect(failed.body.error.code).toBe('LEDGER_INVALID')
    expect(failed.body.status).toMatchObject({ connected: true, loading: false, snapshotId: reloaded.body.status.snapshotId, lastError: { code: 'LEDGER_INVALID' } })
    expect(failed.body.error.diagnostics).toContainEqual(expect.objectContaining({ file: 'years/2026/months/oct.bean', message: expect.stringContaining('余额断言') }))
    const retained = await api.send('/api/ledger/snapshot', { token: api.token })
    expect(getOverview(retained.body.ledger as Ledger, '2026-10').income).toBe('200')
    expect(retained.body.status.lastError.code).toBe('LEDGER_INVALID')

    const disconnected = await api.send('/api/ledger/source', { method: 'DELETE', token: api.token })
    expect(disconnected.status).toBe(200)
    expect(disconnected.body).toMatchObject({ configured: false, connected: false, source: null, snapshotId: null, lastError: null })
    expect((await api.send('/api/ledger/snapshot', { token: api.token })).status).toBe(409)
    await expect(access(files.configPath)).rejects.toThrow()
  })

  it('persists private configuration and restores it through official validation at startup', async () => {
    const files = await fixture()
    const manager = new SourceManager({ configPath: files.configPath, pythonPath })
    const api = await serve(manager)
    expect((await api.send('/api/ledger/connect', { method: 'POST', token: api.token, body: { source: { type: 'local', entryPath: files.entryPath }, allowPlugins: false } })).status).toBe(200)
    expect((await stat(files.configPath)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(files.configPath, 'utf8'))).toMatchObject({ source: { type: 'local', entryPath: files.entryPath }, allowPlugins: false })
    const restoredManager = new SourceManager({ configPath: files.configPath, pythonPath })
    await restoredManager.initialize()
    const restored = await serve(restoredManager)
    const snapshot = await restored.send('/api/ledger/snapshot', { token: restored.token })
    expect(snapshot.status).toBe(200)
    expect(snapshot.body.status).toMatchObject({ configured: true, connected: true, fileCount: 4 })
    expect(getOverview(snapshot.body.ledger as Ledger, '2026-10').surplus).toBe('75')
    await writeFile(files.includedPath, 'THIS IS NOT A VALID LEDGER\n')
    const invalidManager = new SourceManager({ configPath: files.configPath, pythonPath })
    await invalidManager.initialize()
    expect(invalidManager.getStatus()).toMatchObject({ configured: true, connected: false, lastError: { code: 'LEDGER_INVALID' } })
    expect(invalidManager.getSnapshot()).toBeNull()
  })
})

describe('loopback API access checks', () => {
  it('rejects foreign Host, Origin and cross-site requests before issuing a session', async () => {
    const files = await fixture()
    const api = await serve(new SourceManager({ configPath: files.configPath, pythonPath }))
    const cases: Record<string, string | string[]>[] = [
      { Host: 'attacker.invalid' },
      { Origin: 'https://attacker.invalid' },
      { Origin: ['https://attacker.invalid', api.origin] },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]
    for (const headers of cases) {
      const reply = await api.send('/api/session', { headers })
      expect(reply.status).toBe(403)
      expect(reply.body.csrf).toBeUndefined()
    }
  })

  it('requires a valid token for financial reads and all source mutations', async () => {
    const files = await fixture()
    const api = await serve(new SourceManager({ configPath: files.configPath, pythonPath }))
    for (const [path, method] of [['/api/ledger/snapshot', 'GET'], ['/api/ledger/connect', 'POST'], ['/api/ledger/reload', 'POST'], ['/api/ledger/source', 'DELETE']]) {
      expect((await api.send(path, { method })).status).toBe(403)
      expect((await api.send(path, { method, token: 'x'.repeat(api.token.length) })).status).toBe(403)
    }
    expect((await api.send('/api/ledger/status')).status).toBe(200)
    expect((await api.send('/api/ledger/connect', { method: 'POST', token: api.token, body: { source: { type: 'unsupported' }, allowPlugins: false } })).status).toBe(400)
    expect((await api.send('/api/ledger/status')).body.connected).toBe(false)
  })

  it('rejects equal-character-length non-ASCII tokens without turning them into server errors', async () => {
    const files = await fixture()
    const api = await serve(new SourceManager({ configPath: files.configPath, pythonPath }))
    const reply = await api.send('/api/ledger/snapshot', { token: 'é'.repeat(api.token.length) })
    expect(reply.status).toBe(403)
  })
})

describe('server-only source credentials', () => {
  it.each(['github', 'webdav'] as const)('retains %s credentials privately across refresh and restart', async type => {
    const files = await fixture()
    const seen: SourceConfig[] = []
    let cleaned = 0
    const materialize: NonNullable<ConstructorParameters<typeof SourceManager>[0]['materialize']> = async source => {
      seen.push(source)
      return { entryPath: files.entryPath, rootPath: files.root, files: ['books/main.beancount'], description: 'Synthetic remote tree', revision: 'fixture-revision', cleanup: async () => { cleaned++ } }
    }
    const source: SourceConfig = type === 'github'
      ? { type, repository: 'fixture/books', ref: 'main', entryPath: 'books/main.beancount', token: 'SYNTHETIC_GITHUB_TOKEN' }
      : { type, url: 'https://dav.example.invalid/books/', entryPath: 'books/main.beancount', username: 'fixture-user', password: 'SYNTHETIC_DAV_PASSWORD', token: 'SYNTHETIC_DAV_TOKEN' }
    const secrets = type === 'github' ? ['SYNTHETIC_GITHUB_TOKEN'] : ['SYNTHETIC_DAV_PASSWORD', 'SYNTHETIC_DAV_TOKEN']
    const manager = new SourceManager({ configPath: files.configPath, pythonPath, materialize })
    const api = await serve(manager)
    const connected = await api.send('/api/ledger/connect', { method: 'POST', token: api.token, body: { source, allowPlugins: false } })
    expect(connected.status).toBe(200)
    expect(connected.body.status).toMatchObject({ configured: true, connected: true, source: { type, hasToken: true } })
    expect(cleaned).toBe(1)
    expect((await stat(files.configPath)).mode & 0o777).toBe(0o600)
    const config = await readFile(files.configPath, 'utf8')
    for (const secret of secrets) {
      expect(config).toContain(secret)
      expect(connected.text).not.toContain(secret)
      expect((await api.send('/api/ledger/status')).text).not.toContain(secret)
      expect((await api.send('/api/ledger/snapshot', { token: api.token })).text).not.toContain(secret)
    }
    const withoutCredentials = type === 'github' ? { ...source, token: undefined } : { ...source, token: undefined, password: undefined }
    const reused = await api.send('/api/ledger/connect', { method: 'POST', token: api.token, body: { source: withoutCredentials, allowPlugins: false, reuseSavedCredentials: true } })
    expect(reused.status).toBe(200)
    expect(seen.at(-1)).toMatchObject(source)
    const restarted = new SourceManager({ configPath: files.configPath, pythonPath, materialize })
    await restarted.initialize()
    expect(restarted.getStatus()).toMatchObject({ connected: true, source: { type, hasToken: true } })
    expect(seen.at(-1)).toMatchObject(source)
  })

  it('redacts source secrets from loader failures and public lastError', async () => {
    const files = await fixture()
    const secret = 'SYNTHETIC_FAILURE_SECRET'
    const manager = new SourceManager({
      configPath: files.configPath, pythonPath,
      materialize: async () => { throw Object.assign(new Error(`Provider refused ${secret}`), { code: 'SOURCE_DENIED', diagnostics: [{ file: 'main.bean', line: 1, message: `Do not disclose ${secret}` }] }) },
    })
    const api = await serve(manager)
    const reply = await api.send('/api/ledger/connect', { method: 'POST', token: api.token, body: { source: { type: 'github', repository: 'fixture/books', entryPath: 'main.bean', token: secret }, allowPlugins: false } })
    expect(reply.status).toBe(400)
    expect(reply.body.error.code).toBe('SOURCE_DENIED')
    expect(reply.text).not.toContain(secret)
    const status = await api.send('/api/ledger/status')
    expect(status.text).not.toContain(secret)
    expect(status.body.lastError.message).toContain('[已隐藏]')
  })
})
