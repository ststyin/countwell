import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { SourceConfig } from '../../src/domain/source-types'
import { SourceTransfer } from './common'
import { downloadGitHub } from './github'
import { downloadWebDav } from './webdav'
import type { MaterializedSource, MaterializeOptions } from './types'
import { SourceError } from './types'

export type { SourceConfig, LocalSource, GitHubSource, WebDavSource } from '../../src/domain/source-types'
export type { MaterializedSource, MaterializeOptions, SourceLimits } from './types'
export { SourceError, defaultSourceLimits }
import { defaultSourceLimits } from './common'

/** Read-only sources are materialised only for the official loader's lifetime. */
export async function materializeSource(config:SourceConfig,options:MaterializeOptions = {}):Promise<MaterializedSource> {
  if (!config || typeof config !== 'object' || !['local','github','webdav'].includes(config.type)) throw new SourceError('请选择有效的本地、GitHub 或 WebDAV 数据源。', 'invalid_config')
  if (config.type === 'local') {
    if (typeof config.entryPath !== 'string' || !config.entryPath || /[\u0000-\u001f\u007f]/.test(config.entryPath)) throw new SourceError('请配置本地 Beancount 入口文件路径。', 'invalid_config')
    const expanded = config.entryPath === '~' ? homedir() : config.entryPath.startsWith('~/') ? join(homedir(),config.entryPath.slice(2)) : config.entryPath
    try {
      const entryPath = await realpath(resolve(expanded))
      if (!(await stat(entryPath)).isFile()) throw new Error()
      return {entryPath,rootPath:dirname(entryPath),files:[basename(entryPath)],description:`本地 · ${basename(entryPath)}`,cleanup:async () => {}}
    } catch { throw new SourceError('找不到可读取的本地账本入口文件。', 'missing_entry') }
  }
  const rootPath = await mkdtemp(join(tmpdir(),'countwell-source-'))
  const cleanup = async () => { await rm(rootPath,{recursive:true,force:true}) }
  try {
    const transfer = new SourceTransfer(rootPath,options)
    const result = config.type === 'github'
      ? await downloadGitHub(config,transfer,options)
      : await downloadWebDav(config,transfer)
    return {entryPath:join(rootPath,...result.entry.split('/')),rootPath,files:transfer.files.sort(),revision:'revision' in result && typeof result.revision === 'string' ? result.revision : undefined,description:result.description,cleanup}
  } catch (error) {
    await cleanup()
    if (error instanceof SourceError) throw error
    throw new SourceError('无法完整读取账本数据源，临时文件已清理。', 'source_error')
  }
}
