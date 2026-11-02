import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { MaterializeOptions, SourceLimits } from './types'
import { SourceError } from './types'

export const defaultSourceLimits: SourceLimits = {
  maxFiles: 2000, maxDirectories: 1000, maxBytes: 64 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024, maxDepth: 32, timeoutMs: 20_000,
  maxRequests: 5000, maxMetadataBytes: 8 * 1024 * 1024,
  maxDurationMs: 120_000,
}

export function relativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || /^[\/\\]/.test(value)
      || /^[A-Za-z]:/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) {
    throw new SourceError('入口或远程文件路径必须为安全的相对路径。', 'unsafe_path')
  }
  const parts = value.split('/')
  if (parts.some(part => !part || part === '..' || part === '.' || part.toLowerCase() === '.git')) {
    throw new SourceError('远程文件路径不能包含空目录、父目录或 .git。', 'unsafe_path')
  }
  return parts.join('/')
}

export function isLoopback(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase())
}

export function remoteUrl(value: unknown): URL {
  let url: URL
  try { url = new URL(typeof value === 'string' ? value : '') } catch {
    throw new SourceError('数据源地址必须是完整的 HTTPS URL。', 'invalid_config')
  }
  if (url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))) {
    throw new SourceError('远程源需要 HTTPS；HTTP 仅可用于本机。凭证请填写在独立认证字段。', 'invalid_config')
  }
  return url
}

export function encodeRemotePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

export class SourceTransfer {
  readonly limits: SourceLimits
  private readonly fetcher: typeof globalThis.fetch
  private requests = 0
  private bytes = 0
  private readonly startedAt = Date.now()
  private readonly names = new Set<string>()
  private readonly pathSpellings = new Map<string,string>()
  readonly files: string[] = []

  constructor(readonly root: string, options: MaterializeOptions) {
    this.limits = { ...defaultSourceLimits, ...options.limits }
    for (const value of Object.values(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new SourceError('数据源限额必须为正整数。', 'invalid_config')
    }
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  async request(url: URL, init: RequestInit, maxBytes = this.limits.maxMetadataBytes): Promise<Uint8Array> {
    if (++this.requests > this.limits.maxRequests) throw new SourceError('数据源请求次数超过限额。', 'limit_exceeded')
    const remaining = this.limits.maxDurationMs - (Date.now() - this.startedAt)
    if (remaining <= 0) throw new SourceError('数据源完整读取超时。', 'timeout')
    try {
      const response = await this.fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(Math.min(this.limits.timeoutMs,remaining)) })
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel()
        throw new SourceError('数据源返回了重定向，请配置最终地址；认证信息不会转发到其他地址。', 'unsafe_redirect')
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel()
        throw new SourceError('数据源认证失败或没有读取权限，请检查凭证和只读权限。', 'unauthorized')
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new SourceError(`数据源读取失败（HTTP ${response.status}）。`, 'remote_error')
      }
      const declared = response.headers.get('content-length')
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
        await response.body?.cancel()
        throw new SourceError('数据源单次响应超过大小限额。', 'limit_exceeded')
      }
      if (!response.body) return new Uint8Array()
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maxBytes) {
          await reader.cancel()
          throw new SourceError('数据源单次响应超过大小限额。', 'limit_exceeded')
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks, length)
    } catch (error) {
      if (error instanceof SourceError) throw error
      if (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name)) {
        throw new SourceError('数据源请求超时，请稍后重试。', 'timeout')
      }
      throw new SourceError('无法连接数据源，请检查网络、地址与认证配置。', 'remote_error')
    }
  }

  async json(url: URL, headers: HeadersInit): Promise<Record<string, unknown>> {
    const bytes = await this.request(url, { headers })
    try {
      const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      return value as Record<string, unknown>
    } catch { throw new SourceError('数据源返回了无效的 JSON。', 'invalid_response') }
  }

  async store(path: string, data: Uint8Array) {
    const safe = relativePath(path)
    if (safe.split('/').length > this.limits.maxDepth) throw new SourceError('数据源目录层级超过限额。', 'limit_exceeded')
    if (data.byteLength > this.limits.maxFileBytes || this.bytes + data.byteLength > this.limits.maxBytes
        || this.files.length >= this.limits.maxFiles) throw new SourceError('账本源文件数量或大小超过限额。', 'limit_exceeded')
    const collision = safe.normalize('NFC').toLowerCase()
    if (this.names.has(collision)) throw new SourceError('数据源存在重复或大小写冲突的文件路径。', 'unsafe_path')
    const parts = safe.split('/')
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0,index).join('/')
      const key = prefix.normalize('NFC').toLowerCase()
      const previous = this.pathSpellings.get(key)
      if (previous !== undefined && previous !== prefix) throw new SourceError('数据源存在大小写或 Unicode 冲突的目录路径。', 'unsafe_path')
      this.pathSpellings.set(key,prefix)
    }
    const destination = resolve(this.root, ...safe.split('/'))
    if (!destination.startsWith(this.root + sep)) throw new SourceError('远程文件路径越过源根目录。', 'unsafe_path')
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await writeFile(destination, data, { flag: 'wx', mode: 0o600 })
    this.names.add(collision)
    this.files.push(safe)
    this.bytes += data.byteLength
  }
}
