export interface LocalSource { type: 'local'; entryPath: string }
export interface GitHubSource { type: 'github'; repository: string; ref?: string; entryPath: string; token?: string }
export interface WebDavSource { type: 'webdav'; url: string; entryPath: string; username?: string; password?: string; token?: string }
export type SourceConfig = LocalSource | GitHubSource | WebDavSource

export interface PublicSource {
  type: SourceConfig['type']; entryPath: string; repository?: string; ref?: string; url?: string;
  username?: string; hasToken?: boolean; hasPassword?: boolean;
}
export interface SourceDiagnostic { file?: string; line?: number; message: string }
export interface SourceFailure { message: string; code?: string; diagnostics?: SourceDiagnostic[] }
export interface SourceStatus {
  configured: boolean; loading: boolean; connected: boolean; source: PublicSource | null;
  allowPlugins: boolean; loadedAt: string | null; snapshotId: string | null; revision?: string;
  fileCount: number; transactionCount: number; engineVersion?: string; lastError: SourceFailure | null;
}
export interface ConnectRequest { source: SourceConfig; allowPlugins: boolean; reuseSavedCredentials?: boolean }
