import { mkdir, readFile, rename, chmod, writeFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConnectRequest, PublicSource, SourceConfig } from '../src/domain/source-types'

export function publicSource(source: SourceConfig): PublicSource {
  if (source.type === 'local') return { type: source.type, entryPath: source.entryPath }
  if (source.type === 'github') return { type: source.type, entryPath: source.entryPath, repository: source.repository, ref: source.ref, hasToken: Boolean(source.token) }
  return { type: source.type, entryPath: source.entryPath, url: source.url, username: source.username, hasToken: Boolean(source.token), hasPassword: Boolean(source.password) }
}

export function validateConfig(value: unknown): ConnectRequest {
  if (!value || typeof value !== 'object') throw new Error('数据源配置无效。')
  const input = value as Record<string, unknown>
  if (typeof input.allowPlugins !== 'boolean' || !input.source || typeof input.source !== 'object') throw new Error('请填写数据源，并确认插件加载选项。')
  const source = input.source as Record<string, unknown>
  const field = (name: string, required = false): string | undefined => {
    const value = source[name]
    if (value === undefined && !required) return undefined
    if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new Error(`数据源字段 ${name} 无效。`)
    return value
  }
  const entryPath = field('entryPath', true)!
  let normalized: SourceConfig
  if (source.type === 'local') normalized = { type: 'local', entryPath }
  else if (source.type === 'github') normalized = { type: 'github', entryPath, repository: field('repository', true)!, ref: field('ref'), token: field('token') }
  else if (source.type === 'webdav') normalized = { type: 'webdav', entryPath, url: field('url', true)!, username: field('username'), password: field('password'), token: field('token') }
  else throw new Error('仅支持本地、GitHub 或 WebDAV 数据源。')
  if (input.reuseSavedCredentials !== undefined && typeof input.reuseSavedCredentials !== 'boolean') throw new Error('凭证复用选项无效。')
  return { source: normalized, allowPlugins: input.allowPlugins, reuseSavedCredentials: input.reuseSavedCredentials === true }
}

/** Credentials are server-only, private and excluded from Git and web assets. */
export async function saveConfig(path: string, config: ConnectRequest): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
    await chmod(path, 0o600)
  } finally { await rm(temporary, { force: true }) }
}

export async function readConfig(path: string): Promise<ConnectRequest | null> {
  try { return validateConfig(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('本机数据源配置无法读取，请重新配置。') }
}

export async function deleteConfig(path: string) { await rm(path, { force: true }) }
