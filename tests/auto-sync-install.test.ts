import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installAutoSync } from '../scripts/install-auto-sync'

const roots: string[] = []
const appRef = '2'.repeat(40)
const accountId = 'a'.repeat(32)
const siteUrl = 'https://fixture.example.workers.dev'
const workflowPath = '.github/workflows/countwell-sync.yml'
const managedMarker = '# Managed by Countwell auto-sync.'
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function project(options: { noOwner?: boolean; noAppRef?: boolean; savedAppRef?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'countwell-install-test-'))
  roots.push(root)
  const directory = join(root, '.countwell/cloud')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'source.json'), JSON.stringify({ repository: 'fictional/ledger', entryPath: 'books/main.beancount', ref: '8'.repeat(40), ...(!options.noOwner ? { allowedUserId: '42' } : {}) }))
  await writeFile(join(directory, 'auto-sync.json'), JSON.stringify({ accountId, ...(!options.noAppRef ? { appRef: options.savedAppRef ?? appRef } : {}) }))
  await writeFile(join(directory, 'deployment.json'), JSON.stringify({ url: siteUrl }))
  return root
}

function runner(options: { private?: boolean; ownerId?: number; ownerType?: string; enabled?: string; secret?: boolean; existingText?: string; putFails?: boolean; appMissing?: boolean; appSha?: unknown; inspectDenied?: boolean; variableGetError?: string } = {}) {
  const calls: { command: string; args: string[] }[] = []
  const variables = new Map<string, string>()
  if (options.enabled !== undefined) variables.set('COUNTWELL_AUTO_SYNC_ENABLED', options.enabled)
  let text = options.existingText
  const puts: { message: string; content: string; branch: string; sha?: string; fileMode: number }[] = []
  const missing = () => Object.assign(new Error('gh: Not Found (HTTP 404)'), { status: 404 })
  return {
    calls, variables, puts,
    execute: async (command: string, args: string[]) => {
      calls.push({ command, args })
      expect(command).toBe('gh')
      if (args[0] === 'variable' && args[1] === 'get') {
        if (options.variableGetError) throw Object.assign(new Error('Synthetic variable read failure'), { stderr: options.variableGetError })
        if (!variables.has(args[2])) throw missing()
        return { stdout: variables.get(args[2])! + '\n' }
      }
      if (args[0] === 'variable' && args[1] === 'set') {
        variables.set(args[2], args[args.indexOf('--body') + 1])
        expect(args[args.indexOf('--repo') + 1]).toBe('fictional/ledger')
        return { stdout: '' }
      }
      if (args[0] === 'secret') {
        expect(args).toEqual(['secret', 'list', '--repo', 'fictional/ledger', '--json', 'name'])
        return { stdout: JSON.stringify(options.secret ? [{ name: 'CLOUDFLARE_API_TOKEN' }] : []) }
      }
      const endpoint = args.find(arg => arg.startsWith('repos/'))!
      if (endpoint === 'repos/fictional/ledger') return { stdout: JSON.stringify({ private: options.private ?? true, full_name: 'fictional/ledger', default_branch: 'main', owner: { type: options.ownerType ?? 'User', id: options.ownerId ?? 42 } }) }
      if (endpoint.startsWith('repos/ststyin/countwell/commits/')) {
        if (options.appMissing) throw missing()
        return { stdout: JSON.stringify({ sha: options.appSha === undefined ? appRef : options.appSha }) }
      }
      if (endpoint.startsWith('repos/fictional/ledger/git/ref/heads/')) return { stdout: '1'.repeat(40) }
      if (endpoint.startsWith(`repos/fictional/ledger/contents/${workflowPath}`)) {
        if (args.includes('PUT')) {
          const inputPath = args[args.indexOf('--input') + 1]
          const body = JSON.parse(await readFile(inputPath, 'utf8'))
          puts.push({ ...body, fileMode: (await stat(inputPath)).mode & 0o777 })
          if (options.putFails) throw new Error('Synthetic write failure')
          text = Buffer.from(body.content, 'base64').toString('utf8')
          return { stdout: JSON.stringify({ commit: { sha: '3'.repeat(40) } }) }
        }
        if (options.inspectDenied) throw Object.assign(new Error('gh: Forbidden (HTTP 403)'), { status: 403 })
        if (text === undefined) throw missing()
        return { stdout: JSON.stringify({ type: 'file', encoding: 'base64', sha: '4'.repeat(40), content: Buffer.from(text).toString('base64') }) }
      }
      throw new Error(`Unexpected synthetic command endpoint: ${endpoint}`)
    },
  }
}

function mutations(calls: { args: string[] }[]) {
  return calls.filter(call => call.args.includes('PUT') || (call.args[0] === 'variable' && call.args[1] === 'set'))
}

describe('managed private ledger auto-sync installation', () => {
  it('installs only the managed workflow, defaults to the API branch and keeps bootstrap disabled', async () => {
    const root = await project()
    const commands = runner()
    const result = await installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })
    expect(result).toMatchObject({ repository: 'fictional/ledger', branch: 'main', accountId, appRef, siteUrl, activated: false, workflowPath })
    expect(commands.puts).toHaveLength(1)
    const put = commands.puts[0]
    expect(Buffer.from(put.content, 'base64').toString()).toMatch(new RegExp(`^${managedMarker.replaceAll('.', '\\.')}`))
    expect(put).toMatchObject({ branch: 'main', fileMode: 0o600 })
    expect(put.sha).toBeUndefined()
    expect(commands.variables).toEqual(new Map([
      ['COUNTWELL_LEDGER_ENTRY', 'books/main.beancount'], ['COUNTWELL_ALLOWED_USER_ID', '42'],
      ['CLOUDFLARE_ACCOUNT_ID', accountId], ['COUNTWELL_SITE_URL', siteUrl], ['COUNTWELL_AUTO_SYNC_ENABLED', 'false'],
    ]))
    expect(commands.calls.some(call => call.args[0] === 'secret')).toBe(false)
    const metadataPath = join(root, '.countwell/cloud/auto-sync.json')
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).toEqual(result)
    expect((await stat(metadataPath)).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, '.countwell/cloud'))).mode & 0o777).toBe(0o700)
    await expect(readFile(commands.calls.find(call => call.args.includes('PUT'))!.args.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('checks identity and privacy before making any remote changes', async () => {
    for (const invalid of [{ private: false }, { ownerId: 43 }, { ownerType: 'Organization' }]) {
      const root = await project()
      const commands = runner(invalid)
      await expect(installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow('私有个人仓库')
      expect(mutations(commands.calls)).toHaveLength(0)
    }
  })

  it('defaults a new installation to main and preserves the branch for future runs', async () => {
    const root = await project({ noAppRef: true })
    const commands = runner()
    const result = await installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })
    expect(result.appRef).toBe('main')
    expect(commands.calls.some(call => call.args.includes('repos/ststyin/countwell/commits/main'))).toBe(true)
    const metadata = JSON.parse(await readFile(join(root, '.countwell/cloud/auto-sync.json'), 'utf8'))
    expect(metadata.appRef).toBe('main')
    await installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })
    expect(commands.puts).toHaveLength(1)
  })

  it('allows switching a pinned installation to main without replacing main with a resolved SHA', async () => {
    const root = await project()
    const commands = runner({ appSha: '5'.repeat(40) })
    const result = await installAutoSync({ appRef: 'main' }, { projectDirectory: root, runCommand: commands.execute })
    expect(result.appRef).toBe('main')
    expect(JSON.parse(await readFile(join(root, '.countwell/cloud/auto-sync.json'), 'utf8')).appRef).toBe('main')
  })

  it('refuses malformed remote main revisions before making any repository changes', async () => {
    for (const appSha of ['main', 'short', null, 123]) {
      const root = await project({ savedAppRef: 'main' })
      const commands = runner({ appSha })
      await expect(installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow('先推送应用代码')
      expect(mutations(commands.calls)).toHaveLength(0)
    }
  })

  it('accepts the CLI exact missing-variable diagnostic but refuses authentication and unrelated failures', async () => {
    const root = await project()
    const missing = runner({ variableGetError: 'variable COUNTWELL_AUTO_SYNC_ENABLED was not found\n' })
    await expect(installAutoSync({}, { projectDirectory: root, runCommand: missing.execute })).resolves.toMatchObject({ activated: false })
    expect(missing.variables.get('COUNTWELL_AUTO_SYNC_ENABLED')).toBe('false')
    expect(missing.puts).toHaveLength(1)

    for (const stderr of [
      'HTTP 401: Bad credentials\n',
      'variable OTHER_VARIABLE was not found\n',
      'variable COUNTWELL_AUTO_SYNC_ENABLED was not found; permission denied\n',
    ]) {
      const deniedRoot = await project()
      const denied = runner({ variableGetError: stderr })
      await expect(installAutoSync({}, { projectDirectory: deniedRoot, runCommand: denied.execute })).rejects.toThrow('无法检查自动同步开关')
      expect(mutations(denied.calls)).toHaveLength(0)
    }
  })

  it('requires an already pinned local owner and rejects unsafe parameters before network calls', async () => {
    const noOwner = await project({ noOwner: true })
    const missingOwner = runner()
    await expect(installAutoSync({}, { projectDirectory: noOwner, runCommand: missingOwner.execute })).rejects.toThrow('固定的 GitHub 账号 ID')
    expect(missingOwner.calls).toHaveLength(0)
    for (const options of [
      { repository: '--help/ledger' }, { entryPath: '../secret' }, { appRef: 'develop' }, { appRef: 'refs/heads/main' },
      { appRef: "main' || true" }, { appRef: '' }, { appRef: 'main\n' }, { appRef: 'A'.repeat(39) }, { accountId: 'wrong' },
      { siteUrl: 'https://fixture.example.workers.dev/path' }, { siteUrl: 'https://fixture.example.workers.dev/?secret=value' },
      { siteUrl: 'https://user:password@fixture.example.workers.dev' }, { siteUrl: 'http://fixture.example.workers.dev' },
    ]) {
      const root = await project()
      const commands = runner()
      await expect(installAutoSync(options, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow()
      expect(commands.calls).toHaveLength(0)
    }
  })

  it('does not overwrite an unrelated workflow or treat a permissions failure as an absent file', async () => {
    for (const options of [{ existingText: 'name: unrelated\non: push\n' }, { inspectDenied: true }]) {
      const root = await project()
      const commands = runner(options)
      await expect(installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow()
      expect(mutations(commands.calls)).toHaveLength(0)
    }
  })

  it('refuses an unpublished application version before changing the ledger repository', async () => {
    const root = await project()
    const commands = runner({ appMissing: true })
    await expect(installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow('先推送应用代码')
    expect(mutations(commands.calls)).toHaveLength(0)
  })

  it('requires the dedicated Cloudflare secret name before activation without reading secret values', async () => {
    const root = await project()
    const commands = runner({ enabled: 'false' })
    await expect(installAutoSync({ activate: true }, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow('尚未设置 CLOUDFLARE_API_TOKEN')
    expect(mutations(commands.calls)).toHaveLength(0)
    expect(commands.calls.filter(call => call.args[0] === 'secret')).toHaveLength(1)
  })

  it('enables the gate before the production workflow commit and supplies the existing content SHA', async () => {
    const root = await project()
    const commands = runner({ enabled: 'false', secret: true, existingText: managedMarker + '\nname: old\n' })
    const result = await installAutoSync({ activate: true }, { projectDirectory: root, runCommand: commands.execute })
    expect(result.activated).toBe(true)
    expect(commands.variables.get('COUNTWELL_AUTO_SYNC_ENABLED')).toBe('true')
    expect(commands.puts[0].sha).toBe('4'.repeat(40))
    const enable = commands.calls.findIndex(call => call.args[0] === 'variable' && call.args[1] === 'set' && call.args[2] === 'COUNTWELL_AUTO_SYNC_ENABLED' && call.args.at(-1) === 'true')
    const put = commands.calls.findIndex(call => call.args.includes('PUT'))
    expect(enable).toBeGreaterThan(-1)
    expect(enable).toBeLessThan(put)
  })

  it('restores a previously disabled gate when writing the production workflow fails', async () => {
    const root = await project()
    const commands = runner({ enabled: 'false', secret: true, putFails: true })
    await expect(installAutoSync({ activate: true }, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow('无法保存 Countwell 工作流')
    expect(commands.variables.get('COUNTWELL_AUTO_SYNC_ENABLED')).toBe('false')
    expect(JSON.parse(await readFile(join(root, '.countwell/cloud/auto-sync.json'), 'utf8'))).toEqual({ accountId, appRef })
  })

  it('does not create extra commits when a managed workflow is unchanged', async () => {
    const root = await project()
    const commands = runner()
    await installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })
    await installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })
    expect(commands.puts).toHaveLength(1)
  })

  it('does not accidentally downgrade an already enabled installation', async () => {
    const root = await project()
    const commands = runner({ enabled: 'true' })
    await expect(installAutoSync({}, { projectDirectory: root, runCommand: commands.execute })).rejects.toThrow('使用 --activate')
    expect(mutations(commands.calls)).toHaveLength(0)
  })
})
