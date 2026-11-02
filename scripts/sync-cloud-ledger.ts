import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { loadOfficialLedger, OfficialLedgerError } from '../server/engine'
import type { OfficialLedgerSnapshot } from '../server/engine'
import type { SourceStatus } from '../src/domain/source-types'
import type { SourceSnapshot } from '../src/lib/source-client'

const exec = promisify(execFile)

export interface CloudSourceConfig {
  repository: string
  entryPath: string
  ref?: string
  allowedUserId?: string
}

interface SyncOptions {
  repository?: string
  entryPath?: string
  ref?: string
  deploy?: boolean
}

interface CommandResult { stdout: string }
type RunCommand = (command: string, args: string[], cwd: string) => Promise<CommandResult>
interface SyncDependencies {
  projectDirectory?: string
  runCommand?: RunCommand
  load?: typeof loadOfficialLedger
  log?: (message: string) => void
}

export interface SyncResult {
  repository: string
  revision: string
  fileCount: number
  transactionCount: number
  snapshotPath: string
  url?: string
}

class SyncError extends Error {}

export function validateSourceConfig(value: CloudSourceConfig): CloudSourceConfig {
  const repository = typeof value.repository === 'string' ? value.repository.trim() : ''
  const entryPath = typeof value.entryPath === 'string' ? value.entryPath.trim() : ''
  if (value.ref !== undefined && typeof value.ref !== 'string') throw new SyncError('分支、标签或 commit 格式无效。')
  const ref = value.ref?.trim() || undefined
  if (!repository || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository)) {
    throw new SyncError('仓库必须填写 owner/repository。')
  }
  if (!entryPath || entryPath.length > 1000 || isAbsolute(entryPath) || /^[A-Za-z]:/.test(entryPath)
      || entryPath.startsWith('-') || /[\\\0\r\n]/.test(entryPath)
      || entryPath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new SyncError('入口必须是仓库内的相对文件路径，不能越出仓库目录。')
  }
  if (ref && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) || ref.includes('..') || ref.includes('//')
      || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock') || ref.split('/').some(part => part.startsWith('.')))) {
    throw new SyncError('分支、标签或 commit 格式无效。')
  }
  if (value.allowedUserId !== undefined && (typeof value.allowedUserId !== 'string' || !/^[1-9][0-9]*$/.test(value.allowedUserId))) {
    throw new SyncError('已保存的 GitHub 账号 ID 无效，请检查本机云端配置。')
  }
  return { repository, entryPath, ...(ref ? { ref } : {}), ...(value.allowedUserId ? { allowedUserId: value.allowedUserId } : {}) }
}

export function createCloudSnapshot(ledger: OfficialLedgerSnapshot, source: CloudSourceConfig, revision: string): SourceSnapshot {
  if (!/^[a-f0-9]{40,64}$/i.test(revision)) throw new SyncError('未能确认账本的 Git 提交版本。')
  const snapshotId = createHash('sha256').update(revision).update(JSON.stringify(ledger)).digest('hex')
  const status: SourceStatus = {
    configured: true, loading: false, connected: true,
    source: { type: 'github', repository: source.repository, entryPath: source.entryPath, ...(source.ref ? { ref: source.ref } : {}) },
    allowPlugins: false, loadedAt: ledger.loadedAt, snapshotId, revision,
    fileCount: ledger.files.length, transactionCount: ledger.transactions.length,
    engineVersion: ledger.engine.version, lastError: null,
  }
  return { ledger, status }
}

export function deploymentUrl(output: string): string {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  const match = clean.match(/^\s*(https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)\/?\s*$/im)
  if (!match) throw new SyncError('部署命令未返回可确认的 workers.dev 地址，请检查 Cloudflare 部署状态。')
  return match[1]
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const result = await exec(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240_000, windowsHide: true })
  return { stdout: result.stdout }
}

async function optionalFile(path: string): Promise<Buffer | null> {
  try { return await readFile(path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

async function atomicPrivateWrite(path: string, data: string | Buffer): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally { await rm(temporary, { force: true }) }
}

/** Private preparation happens locally; only the explicit --deploy path publishes. */
export async function syncCloudLedger(options: SyncOptions = {}, dependencies: SyncDependencies = {}): Promise<SyncResult> {
  const project = resolve(dependencies.projectDirectory ?? process.cwd())
  const execute = dependencies.runCommand ?? runCommand
  const load = dependencies.load ?? loadOfficialLedger
  const log = dependencies.log ?? (() => undefined)
  const privateRoot = join(project, '.countwell')
  const outputDirectory = join(privateRoot, 'cloud')
  const configPath = join(outputDirectory, 'source.json')
  const snapshotPath = join(outputDirectory, 'ledger.snapshot.txt')
  const deploymentPath = join(outputDirectory, 'deployment.json')
  const previousConfig = await optionalFile(configPath)
  let saved: Partial<CloudSourceConfig> = {}
  if (previousConfig) {
    try {
      const parsed: unknown = JSON.parse(previousConfig.toString())
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid source configuration')
      saved = parsed as Partial<CloudSourceConfig>
    }
    catch { throw new SyncError('本机云端配置不是有效 JSON，请检查 .countwell/cloud/source.json。') }
  }
  const source = validateSourceConfig({
    repository: options.repository ?? saved.repository ?? '',
    entryPath: options.entryPath ?? saved.entryPath ?? '',
    ref: options.ref ?? saved.ref,
    allowedUserId: saved.allowedUserId,
  })

  let metadata: { full_name?: string; default_branch?: string; owner?: { id?: number; type?: string } }
  try {
    const response = await execute('gh', ['api', '--hostname', 'github.com', `repos/${source.repository}`, '--jq', '{full_name,default_branch,owner:{id:.owner.id,type:.owner.type}}'], project)
    metadata = JSON.parse(response.stdout) as typeof metadata
  } catch { throw new SyncError('无法读取 GitHub 仓库信息，请确认 gh 已登录且有该仓库的读取权限。') }
  if (metadata.owner?.type !== 'User' || !Number.isSafeInteger(metadata.owner.id) || (metadata.owner.id ?? 0) < 1) {
    throw new SyncError('当前云端个人账本仅支持个人账号名下的仓库。')
  }
  if (metadata.full_name?.toLowerCase() !== source.repository.toLowerCase()) {
    throw new SyncError('仓库已重命名或转移，请使用当前 owner/repository 重新配置。')
  }
  const allowedUserId = String(metadata.owner.id)
  if (source.allowedUserId && source.allowedUserId !== allowedUserId) {
    throw new SyncError('仓库所有者与已配置的登录账号不一致，已停止同步。')
  }
  const resolvedSource = validateSourceConfig({ ...source, ref: source.ref ?? metadata.default_branch, allowedUserId })
  if (!resolvedSource.ref) throw new SyncError('无法确定仓库默认分支，请指定 --ref。')

  const temporary = await mkdtemp(join(tmpdir(), 'countwell-cloud-sync-'))
  const tree = join(temporary, 'ledger')
  try {
    await chmod(temporary, 0o700)
    log('正在只读获取 GitHub 账本…')
    const commitRef = /^[a-f0-9]{40,64}$/i.test(resolvedSource.ref)
    try {
      await execute('gh', ['repo', 'clone', `https://github.com/${resolvedSource.repository}.git`, tree, '--', '--depth', '1', ...(!commitRef ? ['--branch', resolvedSource.ref] : [])], project)
      if (commitRef) {
        await execute('git', ['-C', tree, 'fetch', '--depth', '1', 'origin', resolvedSource.ref], project)
        await execute('git', ['-C', tree, 'checkout', '--detach', '--force', 'FETCH_HEAD'], project)
      }
    } catch { throw new SyncError('无法获取账本目录，请检查 GitHub 读取权限及分支、标签或 commit。') }
    let revision: string
    try { revision = (await execute('git', ['-C', tree, 'rev-parse', 'HEAD'], project)).stdout.trim() }
    catch { throw new SyncError('无法确认账本提交版本，已停止同步。') }
    if (commitRef && revision.toLowerCase() !== resolvedSource.ref.toLowerCase()) {
      throw new SyncError('已获取的提交与指定 commit 不一致，已停止同步。')
    }
    const ledger = await load(resolve(tree, resolvedSource.entryPath), { sourceRoot: tree, allowPlugins: false })
    const snapshot = createCloudSnapshot(ledger, resolvedSource, revision)
    const previousSnapshot = await optionalFile(snapshotPath)
    const previousDeployment = await optionalFile(deploymentPath)

    await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
    await chmod(privateRoot, 0o700)
    await chmod(outputDirectory, 0o700)
    const backups = new Map([[snapshotPath, previousSnapshot], [configPath, previousConfig], [deploymentPath, previousDeployment]])
    let url: string | undefined
    try {
      await atomicPrivateWrite(snapshotPath, JSON.stringify(snapshot))
      await atomicPrivateWrite(configPath, JSON.stringify(resolvedSource, null, 2) + '\n')
      if (options.deploy) {
        log('正在构建私有账本界面…')
        try { await execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'cloud:build'], project) }
        catch { throw new SyncError('私有界面构建失败，未发布新账本。') }
        log('正在发布受保护的账本快照…')
        let deployed: CommandResult
        try {
          deployed = await execute(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'deploy', '--config', 'wrangler.private.json', '--var', `GITHUB_ALLOWED_USER_ID:${allowedUserId}`], project)
        } catch { throw new SyncError('Cloudflare 部署失败，请检查登录及 Workers 部署权限。') }
        url = deploymentUrl(deployed.stdout)
        await atomicPrivateWrite(deploymentPath, JSON.stringify({ url, callbackUrl: url + '/api/auth/github/callback' }, null, 2) + '\n')
      }
    } catch (error) {
      for (const [path, before] of backups) {
        if (before) await atomicPrivateWrite(path, before)
        else await rm(path, { force: true })
      }
      throw error
    }
    return { repository: source.repository, revision, fileCount: snapshot.status.fileCount, transactionCount: snapshot.status.transactionCount, snapshotPath, ...(url ? { url } : {}) }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function main() {
  const { values } = parseArgs({ options: { repository: { type: 'string' }, entry: { type: 'string' }, ref: { type: 'string' }, deploy: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false })
  if (values.help) {
    console.log('用法：npm run cloud:sync -- --repository owner/repository --entry main.beancount [--ref branch-or-tag-or-commit] [--deploy]')
    console.log('未填写的来源选项沿用 .countwell/cloud/source.json；默认只在本机生成私有快照。')
    return
  }
  const result = await syncCloudLedger({ repository: values.repository, entryPath: values.entry, ref: values.ref, deploy: values.deploy }, { log: message => console.log(message) })
  console.log(`官方校验通过：${result.fileCount} 个文件，${result.transactionCount} 笔交易，提交 ${result.revision.slice(0, 12)}。`)
  console.log(result.url ? `已发布：${result.url}` : '私有快照已准备好。需要发布时添加 --deploy。')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => {
    if (error instanceof OfficialLedgerError) {
      console.error(error.message)
      for (const diagnostic of error.diagnostics.slice(0, 20)) {
        const file = diagnostic.file?.replace(/[\r\n]/g, ' ')
        console.error(`${file ?? ''}${diagnostic.line ? `:${diagnostic.line}` : ''} ${diagnostic.message}`.trim())
      }
    } else console.error(error instanceof SyncError ? error.message : '账本同步未完成；原有合法快照与配置已保留。')
    process.exitCode = 1
  })
}
