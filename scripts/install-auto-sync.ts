import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { createAutoSyncWorkflow } from './auto-sync-workflow'
import { validateSourceConfig } from './sync-cloud-ledger'

const exec = promisify(execFile)
const APP_REPOSITORY = 'ststyin/countwell'
const WORKFLOW_PATH = '.github/workflows/countwell-sync.yml'
const MANAGED_MARKER = '# Managed by Countwell auto-sync.'
const ENABLED_VARIABLE = 'COUNTWELL_AUTO_SYNC_ENABLED'

export interface AutoSyncInstallOptions {
  repository?: string
  entryPath?: string
  branch?: string
  accountId?: string
  appRef?: string
  activate?: boolean
  siteUrl?: string
}

interface CommandResult { stdout: string }
type RunCommand = (command: string, args: string[], cwd: string) => Promise<CommandResult>
interface InstallDependencies {
  projectDirectory?: string
  runCommand?: RunCommand
}

export interface AutoSyncInstallation {
  repository: string
  branch: string
  entryPath: string
  accountId: string
  siteUrl: string
  appRepository: string
  appRef: string
  activated: boolean
  workflowPath: string
  workflowUrl: string
}

class InstallationError extends Error {}

function notFound(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: number; stderr?: string; message?: string }
  return value?.status === 404 || value?.statusCode === 404
    || /\bHTTP 404\b|GitHub API error 404/.test(`${value?.stderr ?? ''} ${value?.message ?? ''}`)
}

async function readMetadata(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata')
    return value as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new InstallationError('本机云端元数据不是有效 JSON，请检查 .countwell/cloud/ 中的配置文件。')
  }
}

function siteOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new InstallationError('请提供私有站点地址，或先保存 cloud/deployment.json。')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)
        || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin')
    return url.origin
  } catch { throw new InstallationError('私有站点必须是完整的 HTTPS workers.dev 根地址。') }
}

async function executeCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const result = await exec(command, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60_000, windowsHide: true })
  return { stdout: result.stdout }
}

async function atomicMetadata(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally { await rm(temporary, { force: true }) }
}

/** Install only the managed workflow and non-secret repository variables. */
export async function installAutoSync(options: AutoSyncInstallOptions = {}, dependencies: InstallDependencies = {}): Promise<AutoSyncInstallation> {
  const project = resolve(dependencies.projectDirectory ?? process.cwd())
  const run = dependencies.runCommand ?? executeCommand
  const directory = join(project, '.countwell/cloud')
  const savedSource = await readMetadata(join(directory, 'source.json'))
  const saved = await readMetadata(join(directory, 'auto-sync.json'))
  const deployment = await readMetadata(join(directory, 'deployment.json'))
  if (!savedSource || typeof savedSource.allowedUserId !== 'string' || !/^[1-9]\d{0,19}$/.test(savedSource.allowedUserId)) {
    throw new InstallationError('请先同步个人账本，保存固定的 GitHub 账号 ID 后再安装自动更新。')
  }
  const source = validateSourceConfig({
    repository: options.repository ?? (saved?.repository as string | undefined) ?? (savedSource.repository as string),
    entryPath: options.entryPath ?? (saved?.entryPath as string | undefined) ?? (savedSource.entryPath as string),
    allowedUserId: savedSource.allowedUserId,
  })
  const accountId = options.accountId ?? saved?.accountId
  const appRefValue = options.appRef ?? saved?.appRef
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(accountId)) throw new InstallationError('Cloudflare Account ID 必须是 32 位十六进制字符串。')
  if (typeof appRefValue !== 'string' || !/^[a-f0-9]{40}$/i.test(appRefValue)) throw new InstallationError('Countwell 版本必须指定完整的 40 位 Git 提交 SHA。')
  const appRef = appRefValue.toLowerCase()
  const siteUrl = siteOrigin(options.siteUrl ?? saved?.siteUrl ?? deployment?.url)
  const activated = options.activate === true

  let metadata: { private?: boolean; full_name?: string; default_branch?: string; owner?: { type?: string; id?: number } }
  try {
    metadata = JSON.parse((await run('gh', ['api', '--hostname', 'github.com', `repos/${source.repository}`, '--jq', '{private,full_name,default_branch,owner:{type:.owner.type,id:.owner.id}}'], project)).stdout) as typeof metadata
  } catch { throw new InstallationError('无法读取私有账本仓库信息，请检查 gh 的读取和工作流写入权限。') }
  if (metadata.private !== true || metadata.owner?.type !== 'User' || !Number.isSafeInteger(metadata.owner.id)
      || String(metadata.owner.id) !== source.allowedUserId || metadata.full_name?.toLowerCase() !== source.repository.toLowerCase()) {
    throw new InstallationError('目标必须是已固定 GitHub 账号名下的私有个人仓库。')
  }
  const branch = validateSourceConfig({ ...source, ref: options.branch ?? metadata.default_branch }).ref
  if (!branch) throw new InstallationError('无法确认账本默认分支，请提供 --branch。')
  try {
    const commit = JSON.parse((await run('gh', ['api', '--hostname', 'github.com', `repos/${APP_REPOSITORY}/commits/${appRef}`, '--jq', '{sha}'], project)).stdout) as { sha?: string }
    if (commit.sha?.toLowerCase() !== appRef) throw new Error('Commit mismatch')
  } catch { throw new InstallationError('指定的 Countwell 提交在远端不可读取，请先推送应用代码。') }
  try {
    await run('gh', ['api', '--hostname', 'github.com', `repos/${source.repository}/git/ref/heads/${branch}`, '--jq', '.object.sha'], project)
  } catch { throw new InstallationError('账本分支不存在或无法读取，未修改工作流。') }

  let existing: { sha: string; text: string } | null = null
  try {
    const file = JSON.parse((await run('gh', ['api', '--hostname', 'github.com', `repos/${source.repository}/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`, '--jq', '{sha,content,encoding,type}'], project)).stdout) as { sha?: string; content?: string; encoding?: string; type?: string }
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 350_000
        || typeof file.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(file.sha)) throw new InstallationError('同名路径不是可识别的 Countwell 工作流，已拒绝覆盖。')
    const text = Buffer.from(file.content, 'base64').toString('utf8')
    if (!text.startsWith(MANAGED_MARKER + '\n')) throw new InstallationError('同名工作流不属于 Countwell，已拒绝覆盖。')
    existing = { sha: file.sha, text }
  } catch (error) {
    if (!notFound(error)) {
      if (error instanceof InstallationError) throw error
      throw new InstallationError('无法检查已有工作流，未修改仓库。')
    }
  }

  let enabled: string | null = null
  try { enabled = (await run('gh', ['variable', 'get', ENABLED_VARIABLE, '--repo', source.repository, '--json', 'value', '--jq', '.value'], project)).stdout.trim() }
  catch (error) {
    const stderr = (error as { stderr?: unknown })?.stderr
    const missingVariable = typeof stderr === 'string' && stderr.trim() === `variable ${ENABLED_VARIABLE} was not found`
    if (!notFound(error) && !missingVariable) throw new InstallationError('无法检查自动同步开关，未修改仓库。')
  }
  if (enabled !== null && !['true', 'false'].includes(enabled)) throw new InstallationError('现有自动同步开关不是 true 或 false，已停止安装。')
  if (!activated && enabled === 'true') throw new InstallationError('自动同步已启用；更新时请使用 --activate，避免将工作流降级为仅手动验证。')
  if (activated) {
    let secrets: { name?: string }[]
    try {
      const value: unknown = JSON.parse((await run('gh', ['secret', 'list', '--repo', source.repository, '--json', 'name'], project)).stdout)
      if (!Array.isArray(value)) throw new Error('Invalid secret list')
      secrets = value as { name?: string }[]
    } catch { throw new InstallationError('无法检查 CI Secret 名称，未启用自动同步。') }
    if (!secrets.some(secret => secret.name === 'CLOUDFLARE_API_TOKEN')) throw new InstallationError('私有仓库尚未设置 CLOUDFLARE_API_TOKEN，未启用自动同步。')
  }
  const workflow = createAutoSyncWorkflow({ ledgerRepository: source.repository, ledgerBranch: branch, appRepository: APP_REPOSITORY, appRef, activate: activated })
  if (!workflow.startsWith(MANAGED_MARKER + '\n')) throw new InstallationError('生成的工作流缺少 Countwell 管理标记，未修改仓库。')

  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(join(project, '.countwell'), 0o700)
  await chmod(directory, 0o700)
  const setVariable = async (name: string, value: string) => {
    try { await run('gh', ['variable', 'set', name, '--repo', source.repository, '--body', value], project) }
    catch { throw new InstallationError(`无法保存仓库变量 ${name}，安装未完成。`) }
  }
  await setVariable('COUNTWELL_LEDGER_ENTRY', source.entryPath)
  await setVariable('COUNTWELL_ALLOWED_USER_ID', source.allowedUserId!)
  await setVariable('CLOUDFLARE_ACCOUNT_ID', accountId.toLowerCase())
  await setVariable('COUNTWELL_SITE_URL', siteUrl)
  if (!activated && enabled === null) await setVariable(ENABLED_VARIABLE, 'false')
  if (activated && enabled !== 'true') await setVariable(ENABLED_VARIABLE, 'true')

  if (existing?.text !== workflow) {
    const inputPath = join(directory, `.workflow-install-${randomUUID()}.json`)
    try {
      await writeFile(inputPath, JSON.stringify({ message: activated ? 'ci: enable Countwell ledger auto-sync' : 'ci: configure Countwell ledger auto-sync', content: Buffer.from(workflow).toString('base64'), branch, ...(existing ? { sha: existing.sha } : {}) }), { mode: 0o600, flag: 'wx' })
      await run('gh', ['api', '--hostname', 'github.com', '--method', 'PUT', `repos/${source.repository}/contents/${WORKFLOW_PATH}`, '--input', inputPath], project)
    } catch {
      if (activated && enabled === 'false') {
        try { await setVariable(ENABLED_VARIABLE, 'false') }
        catch { throw new InstallationError('工作流保存失败，启用开关也未能恢复，请检查仓库权限和自动同步状态。') }
      }
      throw new InstallationError('无法保存 Countwell 工作流，请检查 workflow 写入权限。')
    }
    finally { await rm(inputPath, { force: true }) }
  }
  const result: AutoSyncInstallation = {
    repository: source.repository, branch, entryPath: source.entryPath, accountId: accountId.toLowerCase(), siteUrl,
    appRepository: APP_REPOSITORY, appRef, activated, workflowPath: WORKFLOW_PATH,
    workflowUrl: `https://github.com/${source.repository}/actions/workflows/countwell-sync.yml`,
  }
  await atomicMetadata(join(directory, 'auto-sync.json'), result)
  return result
}

async function main() {
  const { values } = parseArgs({ options: { repository: { type: 'string' }, entry: { type: 'string' }, branch: { type: 'string' }, 'account-id': { type: 'string' }, 'app-ref': { type: 'string' }, 'site-url': { type: 'string' }, activate: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false })
  if (values.help) {
    console.log('用法：npm run cloud:auto:install -- --app-ref <完整提交SHA> [--repository owner/repo] [--entry main.beancount] [--branch master] [--account-id ID] [--site-url URL] [--activate]')
    console.log('默认只安装手动验证工作流；--activate 检查 Secret 名称后启用提交自动发布。')
    return
  }
  const result = await installAutoSync({ repository: values.repository, entryPath: values.entry, branch: values.branch, accountId: values['account-id'], appRef: values['app-ref'], siteUrl: values['site-url'], activate: values.activate })
  console.log(`${result.activated ? '已启用提交自动更新' : '已安装手动验证工作流'}：${result.workflowUrl}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => {
    console.error(error instanceof InstallationError ? error.message : '自动同步安装未完成；未读取或复制任何凭证。')
    process.exitCode = 1
  })
}
