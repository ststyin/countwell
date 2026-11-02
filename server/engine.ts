import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Ledger } from '../src/domain/types'

export interface EngineDiagnostic {
  file?: string | null
  line?: number | null
  message: string
}

export interface EngineOptions {
  pythonPath?: string
  allowPlugins?: boolean
  /** Remote trees must be contained in this materialized source directory. */
  sourceRoot?: string
  timeoutMs?: number
}

export interface OfficialLedgerSnapshot extends Ledger {
  engine: { name: 'beancount'; version: string }
  loadedAt: string
  files: { path: string; content: string }[]
}

export class OfficialLedgerError extends Error {
  readonly code: string
  readonly diagnostics: EngineDiagnostic[]

  constructor(code: string, message: string, diagnostics: EngineDiagnostic[] = []) {
    super(message)
    this.name = 'OfficialLedgerError'
    this.code = code
    this.diagnostics = diagnostics
  }
}

function pythonCommand(options: EngineOptions): string {
  if (options.pythonPath) return options.pythonPath
  if (process.env.COUNTWELL_PYTHON) return process.env.COUNTWELL_PYTHON
  const local = resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return existsSync(local) ? local : 'python3'
}

/** Load once in an isolated subprocess; never return partially valid entries. */
export async function loadOfficialLedger(entryPath: string, options: EngineOptions = {}): Promise<OfficialLedgerSnapshot> {
  if (typeof entryPath !== 'string' || !entryPath.trim()) {
    throw new OfficialLedgerError('ENTRY_NOT_FOUND', '请配置账本入口文件路径。')
  }
  const helper = fileURLToPath(new URL('./beancount/load.py', import.meta.url))
  return new Promise((resolveLedger, reject) => {
    const child = execFile(pythonCommand(options), ['-B', helper], {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code
        reject(new OfficialLedgerError(code === 'ENOENT' ? 'ENGINE_UNAVAILABLE' : error.killed ? 'ENGINE_TIMEOUT' : 'ENGINE_LOAD_FAILED',
          code === 'ENOENT' ? '未找到 Python 运行环境，请配置 COUNTWELL_PYTHON 并安装 requirements.txt。'
            : error.killed ? '账本加载超时，请检查 include 和已授权插件。' : '官方 Beancount 引擎未能完成加载。'))
        return
      }
      try {
        const result = JSON.parse(stdout) as {
          ok: boolean
          ledger?: OfficialLedgerSnapshot
          error?: { code: string; message: string; diagnostics: EngineDiagnostic[] }
        }
        if (!result.ok || !result.ledger) {
          const failure = result.error
          reject(new OfficialLedgerError(failure?.code ?? 'ENGINE_LOAD_FAILED', failure?.message ?? '官方 Beancount 未能完整加载账本。', failure?.diagnostics))
          return
        }
        if (!Array.isArray(result.ledger.transactions) || !Array.isArray(result.ledger.accounts)
            || result.ledger.engine?.name !== 'beancount') throw new Error('Invalid engine protocol')
        resolveLedger(result.ledger)
      } catch {
        reject(new OfficialLedgerError('ENGINE_PROTOCOL_ERROR', '官方 Beancount 返回了无法读取的快照，请检查已授权插件。'))
      }
    })
    // Neither ledger source nor plugin stdout/stderr is emitted to server logs.
    child.stdin?.end(JSON.stringify({ entryPath, sourceRoot: options.sourceRoot, allowPlugins: options.allowPlugins === true }))
  })
}
