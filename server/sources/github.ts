import { createHash } from 'node:crypto'
import type { GitHubSource } from '../../src/domain/source-types'
import { remoteUrl, relativePath, SourceTransfer } from './common'
import type { MaterializeOptions } from './types'
import { SourceError } from './types'

const shaPattern = /^[a-f0-9]{40}$/i
interface TreeEntry { path: string; mode: string; type: string; sha: string; size?: number }

export async function downloadGitHub(source: GitHubSource, transfer: SourceTransfer, options: MaterializeOptions) {
  if (typeof source.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(source.repository)
      || source.repository.split('/').some(part => ['.','..'].includes(part))) {
    throw new SourceError('GitHub 仓库请使用 owner/repository 格式。', 'invalid_config')
  }
  const entry = relativePath(source.entryPath)
  const api = remoteUrl(options.githubApiBase ?? 'https://api.github.com')
  if (api.origin !== 'https://api.github.com' && !['localhost','127.0.0.1','[::1]'].includes(api.hostname)) {
    throw new SourceError('GitHub 认证只允许发送到官方 API。', 'invalid_config')
  }
  if (api.pathname !== '/') throw new SourceError('GitHub API 根地址无效。', 'invalid_config')
  const headers: Record<string,string> = {
    Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2026-03-10', 'User-Agent':'Countwell',
  }
  if (source.token) headers.Authorization = `Bearer ${source.token}`
  const repository = source.repository.split('/').map(encodeURIComponent).join('/')
  const endpoint = (path: string) => new URL(`repos/${repository}/${path}`,api)
  const commit = await transfer.json(endpoint(`commits/${encodeURIComponent(source.ref || 'HEAD')}`),headers)
  const revision = typeof commit.sha === 'string' && shaPattern.test(commit.sha) ? commit.sha : null
  const treeSha = (commit.commit as {tree?:{sha?:unknown}} | undefined)?.tree?.sha
  if (!revision || typeof treeSha !== 'string' || !shaPattern.test(treeSha)) {
    throw new SourceError('GitHub 没有返回有效的固定提交。', 'invalid_response')
  }
  const entries: TreeEntry[] = []
  let directoryCount = 0
  async function walkTree(sha: string, prefix: string, recursive: boolean): Promise<void> {
    if (++directoryCount > transfer.limits.maxDirectories) throw new SourceError('仓库目录数量超过限额。', 'limit_exceeded')
    const target = endpoint(`git/trees/${sha}`)
    if (recursive) target.searchParams.set('recursive','1')
    const payload = await transfer.json(target,headers)
    if (!Array.isArray(payload.tree)) throw new SourceError('GitHub 目录树格式无效。', 'invalid_response')
    if (payload.truncated === true) {
      if (recursive) return walkTree(sha,prefix,false)
      throw new SourceError('GitHub 目录树被截断，不能保证完整读取。', 'limit_exceeded')
    }
    if (payload.tree.length > transfer.limits.maxFiles + transfer.limits.maxDirectories) throw new SourceError('仓库目录树超过限额。', 'limit_exceeded')
    for (const value of payload.tree) {
      if (!value || typeof value !== 'object') throw new SourceError('GitHub 目录项格式无效。', 'invalid_response')
      const item = value as TreeEntry
      const path = relativePath(prefix + item.path)
      if (path.split('/').length > transfer.limits.maxDepth) throw new SourceError('仓库目录层级超过限额。', 'limit_exceeded')
      if (item.mode === '120000' || item.type === 'commit' || item.mode === '160000') {
        throw new SourceError('远程账本源不支持符号链接或 Git 子模块，请提供普通目录和文件。', 'unsupported_entry')
      }
      if (!shaPattern.test(item.sha)) throw new SourceError('GitHub 文件对象标识无效。', 'invalid_response')
      if (item.type === 'tree') {
        if (!recursive) await walkTree(item.sha,path+'/',false)
      } else if (item.type === 'blob' && ['100644','100755'].includes(item.mode)) {
        if (typeof item.size === 'number' && item.size > transfer.limits.maxFileBytes) throw new SourceError('仓库文件超过大小限额。', 'limit_exceeded')
        entries.push({...item,path})
        if (entries.length > transfer.limits.maxFiles) throw new SourceError('仓库文件数量超过限额。', 'limit_exceeded')
      } else throw new SourceError('GitHub 包含不支持的文件对象。', 'invalid_response')
    }
  }
  await walkTree(treeSha,'',true)
  if (!entries.some(item => item.path === entry)) throw new SourceError('入口文件不在所选 GitHub 提交中。', 'missing_entry')
  // Blob URLs are derived from the pinned tree, never from untrusted response URLs.
  for (const item of entries) {
    const bytes = await transfer.request(endpoint(`git/blobs/${item.sha}`), {
      headers:{...headers,Accept:'application/vnd.github.raw+json'},
    },transfer.limits.maxFileBytes)
    const actual = createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
    if (actual !== item.sha.toLowerCase()) throw new SourceError('GitHub 文件内容与固定提交不一致，已停止加载。', 'invalid_response')
    await transfer.store(item.path,bytes)
  }
  return {revision,description:`GitHub · ${source.repository}`,entry}
}
