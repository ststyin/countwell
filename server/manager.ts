import { randomUUID } from 'node:crypto'
import type { Ledger } from '../src/domain/types'
import type { ConnectRequest, SourceFailure, SourceStatus } from '../src/domain/source-types'
import { loadOfficialLedger } from './engine'
import { materializeSource } from './sources'
import { deleteConfig, publicSource, readConfig, saveConfig } from './config'

export class SourceManager {
  private config: ConnectRequest | null = null
  private ledger: Ledger | null = null
  private status: SourceStatus = { configured: false, loading: false, connected: false, source: null, allowPlugins: false, loadedAt: null, snapshotId: null, fileCount: 0, transactionCount: 0, lastError: null }
  constructor(private options: { configPath: string; pythonPath?: string; materialize?: typeof materializeSource; load?: typeof loadOfficialLedger }) {}

  getStatus(): SourceStatus { return { ...this.status } }
  getSnapshot() { return this.ledger ? { ledger: this.ledger, status: this.getStatus() } : null }

  async initialize() {
    try {
      const config = await readConfig(this.options.configPath)
      if (config) {
        this.config = config
        this.status = { ...this.status, configured: true, source: publicSource(config.source), allowPlugins: config.allowPlugins }
        await this.connect(config, false)
      }
    } catch (error) { this.status.lastError = this.failure(error) }
  }

  async connect(config: ConnectRequest, persist = true) {
    if (this.status.loading) throw new Error('账本正在加载，请等待本次完成。')
    config = this.withSavedCredentials(config)
    this.status = { ...this.status, loading: true, lastError: null }
    let cleanup: (() => Promise<void>) | undefined
    try {
      const materialized = await (this.options.materialize ?? materializeSource)(config.source)
      cleanup = materialized.cleanup
      const ledger = await (this.options.load ?? loadOfficialLedger)(materialized.entryPath, {
        pythonPath: this.options.pythonPath, allowPlugins: config.allowPlugins,
        sourceRoot: config.source.type === 'local' ? undefined : materialized.rootPath,
      })
      if (persist) await saveConfig(this.options.configPath, config)
      this.config = config
      this.ledger = ledger
      const loadedAt = new Date().toISOString()
      this.status = {
        configured: true, loading: false, connected: true, source: publicSource(config.source),
        allowPlugins: config.allowPlugins, loadedAt, snapshotId: randomUUID(), revision: materialized.revision,
        fileCount: ledger.files?.length ?? 1, transactionCount: ledger.transactions.length,
        engineVersion: (ledger as Ledger & { engine?: { version: string } }).engine?.version,
        lastError: null,
      }
      return this.getSnapshot()!
    } catch (error) {
      const failure = this.failure(error, config)
      this.status = { ...this.status, loading: false, lastError: failure }
      throw Object.assign(new Error(failure.message), { code: failure.code, diagnostics: failure.diagnostics })
    } finally { await cleanup?.().catch(() => undefined) }
  }

  async reload() {
    if (!this.config) throw new Error('请先连接一个账本数据源。')
    return this.connect(this.config)
  }

  async disconnect() {
    if (this.status.loading) throw new Error('账本正在加载，请等待本次完成。')
    await deleteConfig(this.options.configPath)
    this.config = null; this.ledger = null
    this.status = { configured: false, loading: false, connected: false, source: null, allowPlugins: false, loadedAt: null, snapshotId: null, fileCount: 0, transactionCount: 0, lastError: null }
    return this.getStatus()
  }

  private failure(error: unknown, config?: ConnectRequest): SourceFailure {
    const value = error as { message?: string; code?: string; diagnostics?: SourceFailure['diagnostics'] }
    const source = config?.source ?? this.config?.source
    const secrets = source?.type === 'github' ? [source.token] : source?.type === 'webdav' ? [source.password, source.token] : []
    const redact = (text: string) => secrets.filter((secret): secret is string => Boolean(secret)).reduce((text, secret) => text.split(secret).join('[已隐藏]'), text).slice(0, 2000)
    return { message: redact(value.message ?? '无法完整加载账本，请检查数据源和 Beancount 校验结果。'), code: value.code,
      diagnostics: value.diagnostics?.slice(0, 50).map(diagnostic => ({ file: diagnostic.file, line: diagnostic.line, message: redact(diagnostic.message) })) }
  }

  private withSavedCredentials(config: ConnectRequest): ConnectRequest {
    if (!config.reuseSavedCredentials) return config
    const source = { ...config.source }, before = this.config?.source
    if (source.type === 'github' && before?.type === 'github' && source.repository === before.repository) {
      source.token ||= before.token
    } else if (source.type === 'webdav' && before?.type === 'webdav' && source.url === before.url && source.username === before.username) {
      source.token ||= before.token; source.password ||= before.password
    } else throw new Error('数据源地址发生变化，请重新输入凭证。')
    return { source, allowPlugins: config.allowPlugins }
  }
}
