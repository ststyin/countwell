export type { SourceConfig, LocalSource, GitHubSource, WebDavSource } from '../../src/domain/source-types'

export interface SourceLimits {
  maxFiles: number
  maxDirectories: number
  maxBytes: number
  maxFileBytes: number
  maxDepth: number
  timeoutMs: number
  maxRequests: number
  maxMetadataBytes: number
  maxDurationMs: number
}

export interface MaterializeOptions {
  fetch?: typeof globalThis.fetch
  limits?: Partial<SourceLimits>
  /** Test-only transport seam; custom endpoints are restricted to loopback. */
  githubApiBase?: string
}

export interface MaterializedSource {
  entryPath: string
  rootPath: string
  files: string[]
  revision?: string
  description: string
  cleanup(): Promise<void>
}

export class SourceError extends Error {
  constructor(message: string, public readonly code = 'source_error') {
    super(message)
    this.name = 'SourceError'
  }
}
