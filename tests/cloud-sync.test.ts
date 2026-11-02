import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCloudSnapshot, deploymentUrl, syncCloudLedger, validateSourceConfig } from '../scripts/sync-cloud-ledger'
import type { OfficialLedgerSnapshot } from '../server/engine'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function project() { const root = await mkdtemp(join(tmpdir(), 'countwell-cloud-test-')); roots.push(root); return root }
const revision = '1'.repeat(40)
const ledger: OfficialLedgerSnapshot = {
  title: 'Synthetic ledger', source: '; Fictional', defaultMonth: '2026-10', accounts: [], accountNames: [], commodities: [], prices: [], transactions: [],
  files: [{ path: 'books/main.beancount', content: '; Fictional' }], engine: { name: 'beancount', version: '3.2.3' }, loadedAt: '2026-11-01T00:00:00.000Z',
}

function commands(options: { buildFails?: boolean; wrongOwner?: boolean } = {}) {
  const clones: string[] = []
  const calls: { command: string; args: string[] }[] = []
  return {
    clones, calls,
    execute: async (command: string, args: string[]) => {
      calls.push({ command, args })
      if (command === 'gh' && args[0] === 'api') return { stdout: JSON.stringify({ full_name: 'fictional/ledger', default_branch: 'main', owner: { id: options.wrongOwner ? 43 : 42, type: 'User' } }) }
      if (command === 'gh' && args[0] === 'repo') {
        const destination = args[3]
        clones.push(dirname(destination))
        await mkdir(join(destination, 'books'), { recursive: true })
        await writeFile(join(destination, 'books/main.beancount'), '; Fictional')
        return { stdout: '' }
      }
      if (command === 'git' && args.includes('rev-parse')) return { stdout: revision + '\n' }
      if (/^npm/.test(command) && options.buildFails) throw new Error('Synthetic build failure')
      if (/^npx/.test(command)) return { stdout: 'Deployed fictional worker\n  https://fictional.example.workers.dev\nCurrent Version ID: fixture\n' }
      return { stdout: '' }
    },
  }
}

describe('private cloud ledger synchronization', () => {
  it('rejects option injection and paths escaping the repository before accessing GitHub', async () => {
    const root = await project()
    const runner = commands()
    for (const invalid of [
      { repository: '--help/ledger', entryPath: 'main.beancount' },
      { repository: 'fictional/ledger', entryPath: '../secret' },
      { repository: 'fictional/ledger', entryPath: '/tmp/ledger' },
      { repository: 'fictional/ledger', entryPath: 'C:\\ledger.bean' },
      { repository: 'fictional/ledger', entryPath: 'main.beancount', ref: '--upload-pack=command' },
      { repository: 'fictional/ledger', entryPath: 'main.beancount', ref: 'refs/heads/../main' },
    ]) await expect(syncCloudLedger(invalid, { projectDirectory: root, runCommand: runner.execute })).rejects.toThrow()
    expect(runner.calls).toHaveLength(0)
    expect(validateSourceConfig({ repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: 'release/2026-10' }).ref).toBe('release/2026-10')
  })

  it('writes only an official private snapshot with owner identity and removes its temporary clone', async () => {
    const root = await project()
    const runner = commands()
    const result = await syncCloudLedger({ repository: 'fictional/ledger', entryPath: 'books/main.beancount' }, {
      projectDirectory: root, runCommand: runner.execute,
      load: async (entry, options) => {
        expect(entry.endsWith('/ledger/books/main.beancount')).toBe(true)
        expect(options?.sourceRoot?.endsWith('/ledger')).toBe(true)
        expect(options?.allowPlugins).toBe(false)
        expect((await stat(dirname(dirname(dirname(entry))))).mode & 0o777).toBe(0o700)
        return ledger
      },
    })
    const config = JSON.parse(await readFile(join(root, '.countwell/cloud/source.json'), 'utf8'))
    const snapshot = JSON.parse(await readFile(result.snapshotPath, 'utf8'))
    expect(config).toEqual({ repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: 'main', allowedUserId: '42' })
    expect(snapshot.status.source).toEqual({ type: 'github', repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: 'main' })
    expect(snapshot.status.revision).toBe(revision)
    expect(snapshot.ledger.files[0].content).toBe('; Fictional')
    expect(snapshot.status.snapshotId).toHaveLength(64)
    expect((await stat(result.snapshotPath)).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, '.countwell/cloud/source.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, '.countwell/cloud'))).mode & 0o777).toBe(0o700)
    for (const clone of runner.clones) await expect(stat(clone)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(runner.calls.some(call => /^npm|^npx/.test(call.command))).toBe(false)
  })

  it('does not overwrite the prior snapshot or configuration when official validation fails', async () => {
    const root = await project()
    const directory = join(root, '.countwell/cloud')
    await mkdir(directory, { recursive: true })
    const before = { repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: 'main', allowedUserId: '42' }
    await writeFile(join(directory, 'source.json'), JSON.stringify(before))
    await writeFile(join(directory, 'ledger.snapshot.txt'), 'previous valid snapshot')
    const runner = commands()
    await expect(syncCloudLedger({}, { projectDirectory: root, runCommand: runner.execute, load: async () => { throw new Error('Synthetic validation failure') } })).rejects.toThrow('Synthetic validation failure')
    expect(await readFile(join(directory, 'ledger.snapshot.txt'), 'utf8')).toBe('previous valid snapshot')
    expect(JSON.parse(await readFile(join(directory, 'source.json'), 'utf8'))).toEqual(before)
    for (const clone of runner.clones) await expect(stat(clone)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rolls local outputs back when deployment preparation fails and refuses owner changes', async () => {
    const root = await project()
    const directory = join(root, '.countwell/cloud')
    await mkdir(directory, { recursive: true })
    const configText = JSON.stringify({ repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: 'main', allowedUserId: '42' })
    await writeFile(join(directory, 'source.json'), configText)
    await writeFile(join(directory, 'ledger.snapshot.txt'), 'previous valid snapshot')
    const runner = commands({ buildFails: true })
    await expect(syncCloudLedger({ deploy: true }, { projectDirectory: root, runCommand: runner.execute, load: async () => ledger })).rejects.toThrow('构建失败')
    expect(await readFile(join(directory, 'ledger.snapshot.txt'), 'utf8')).toBe('previous valid snapshot')
    expect(await readFile(join(directory, 'source.json'), 'utf8')).toBe(configText)
    expect(runner.calls.some(call => /^npx/.test(call.command))).toBe(false)
    const moved = commands({ wrongOwner: true })
    await expect(syncCloudLedger({}, { projectDirectory: root, runCommand: moved.execute, load: async () => ledger })).rejects.toThrow('所有者')
    expect(moved.clones).toHaveLength(0)
  })

  it('deploys explicitly and records only the actual returned address and callback', async () => {
    const root = await project()
    const runner = commands()
    const result = await syncCloudLedger({ repository: 'fictional/ledger', entryPath: 'books/main.beancount', deploy: true }, { projectDirectory: root, runCommand: runner.execute, load: async () => ledger })
    expect(result.url).toBe('https://fictional.example.workers.dev')
    const deploy = runner.calls.find(call => /^npx/.test(call.command))!
    expect(deploy.args).toEqual(['wrangler', 'deploy', '--config', 'wrangler.private.json', '--var', 'GITHUB_ALLOWED_USER_ID:42'])
    expect(JSON.parse(await readFile(join(root, '.countwell/cloud/deployment.json'), 'utf8'))).toEqual({ url: result.url, callbackUrl: result.url + '/api/auth/github/callback' })
    expect(deploymentUrl('\u001b[32m  https://fictional.example.workers.dev\u001b[0m\n')).toBe(result.url)
    expect(() => deploymentUrl('https://fictional.example.workers.dev.attacker.test')).toThrow()
    expect(() => deploymentUrl('https://fictional.example.workers.dev/?token=secret')).toThrow()
    expect(createCloudSnapshot(ledger, { repository: 'fictional/ledger', entryPath: 'main.beancount' }, revision).status.revision).toBe(revision)
  })

  it('checks out an exact commit and refuses a mismatched resulting revision', async () => {
    const root = await project()
    const runner = commands()
    await expect(syncCloudLedger({ repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: '2'.repeat(40) }, { projectDirectory: root, runCommand: runner.execute, load: async () => ledger })).rejects.toThrow('提交与指定 commit 不一致')
    expect(runner.calls.some(call => call.command === 'git' && call.args.includes('fetch') && call.args.at(-1) === '2'.repeat(40))).toBe(true)
    await expect(readFile(join(root, '.countwell/cloud/ledger.snapshot.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const clone of runner.clones) await expect(stat(clone)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
