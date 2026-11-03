import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Cloud, FolderOpen, Github, LoaderCircle, LogOut, RefreshCw, Unplug } from 'lucide-react'
import type { ConnectRequest, SourceConfig } from '../domain/source-types'
import type { LedgerSourceController } from '../hooks/useLedgerSource'
import { cloudMode } from '../lib/runtime'
import { SourceClientError, sourceRequest } from '../lib/source-client'

export default function SourceSettings({ controller }: { controller: LedgerSourceController }) {
  return cloudMode ? <CloudSourceSettings controller={controller} /> : <LocalSourceSettings controller={controller} />
}

function CloudSourceSettings({ controller }: { controller: LedgerSourceController }) {
  const { status, busy, error, reload } = controller
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const logout = async () => {
    setLoggingOut(true); setLogoutError('')
    try {
      await sourceRequest('/api/auth/logout', 'POST')
      window.dispatchEvent(new Event('countwell:session-expired'))
      window.location.replace('/')
    } catch (error) {
      if (error instanceof SourceClientError && error.failure.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event('countwell:session-expired'))
      else setLogoutError('退出未完成，请重试。')
    } finally { setLoggingOut(false) }
  }

  return <section className="panel settings-section source-settings" id="data-source">
    <div className="section-heading"><h2>账本来源</h2><Github size={21} className="settings-heading-icon" /></div>
    {status?.connected ? <dl className="cloud-source-details">
      <div><dt>GitHub</dt><dd>{status.source?.repository ? <a href={`https://github.com/${status.source.repository}`} target="_blank" rel="noreferrer">{status.source.repository}</a> : '已连接'}</dd></div>
      {status.loadedAt && <div><dt>同步</dt><dd><time dateTime={status.loadedAt}>{new Date(status.loadedAt).toLocaleString('zh-CN')}</time></dd></div>}
    </dl> : <p className="cloud-source-pending" role="status">{controller.initialLoading ? '正在读取账本…' : '账本暂不可用'}</p>}
    <div className="setting-actions"><button className="button" disabled={busy || loggingOut} onClick={() => void reload()}>{busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}刷新账本</button><button className="button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={16} />{loggingOut ? '正在退出…' : '退出登录'}</button></div>
    {(error || logoutError) && <div className="source-error" role="alert">{logoutError || error?.message}</div>}
    {status?.connected && <details className="disclosure"><summary>同步详情</summary><div className="disclosure-content"><dl className="cloud-source-details"><div><dt>入口</dt><dd>{status.source?.entryPath}</dd></div><div><dt>账本</dt><dd>{status.fileCount} 个文件 · {status.transactionCount} 笔交易</dd></div>{status.revision && <div><dt>提交</dt><dd>{status.revision.slice(0, 12)}</dd></div>}</dl></div></details>}
  </section>
}

function LocalSourceSettings({ controller }: { controller: LedgerSourceController }) {
  const { status, backendAvailable, busy, error, connect, reload, useDemo } = controller
  const [type, setType] = useState<SourceConfig['type']>('local')
  const [entryPath, setEntryPath] = useState('')
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [allowPlugins, setAllowPlugins] = useState(false)
  const [reuse, setReuse] = useState(true)
  useEffect(() => {
    if (!status?.source) return
    const source = status.source
    setType(source.type); setEntryPath(source.entryPath); setRepository(source.repository ?? ''); setRef(source.ref ?? '')
    setUrl(source.url ?? ''); setUsername(source.username ?? ''); setAllowPlugins(status.allowPlugins)
    setPassword(''); setToken(''); setReuse(true)
  }, [status?.snapshotId])

  const sameStoredTarget = status?.source?.type === type && (type === 'github' ? status.source.repository === repository : type === 'webdav' ? status.source.url === url && (status.source.username ?? '') === username : false)
  const hasCredentials = sameStoredTarget && (status?.source?.hasToken || status?.source?.hasPassword)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    let source: SourceConfig
    if (type === 'local') source = { type, entryPath }
    else if (type === 'github') source = { type, entryPath, repository, ref: ref || undefined, token: token || undefined }
    else source = { type, entryPath, url, username: username || undefined, password: password || undefined, token: token || undefined }
    const request: ConnectRequest = { source, allowPlugins, reuseSavedCredentials: Boolean(hasCredentials && reuse) }
    if (await connect(request)) { setPassword(''); setToken('') }
  }

  return <section className="panel settings-section source-settings" id="data-source">
    <div className="section-heading"><h2>账本来源</h2><FolderOpen size={21} className="settings-heading-icon" /></div>
    {backendAvailable === false && <div className="source-notice"><strong>未连接账本服务</strong><details className="disclosure"><summary>连接帮助</summary><div className="disclosure-content"><p>在项目目录运行 <code>npm run dev</code>，或 <code>npm run build &amp;&amp; npm start</code>。</p></div></details></div>}
    {status?.connected && <div className="source-connected"><Check size={18} /><div><strong>已连接</strong><p>{status.source?.type === 'local' ? '本地' : status.source?.type === 'github' ? 'GitHub' : 'WebDAV'} · {status.source?.entryPath}</p></div></div>}
    <div className="segmented source-tabs" aria-label="账本数据源类型">{([{ value: 'local', label: '本地目录', icon: FolderOpen }, { value: 'github', label: 'GitHub', icon: Github }, { value: 'webdav', label: 'WebDAV', icon: Cloud }] as const).map(item => <button key={item.value} type="button" aria-pressed={type === item.value} disabled={busy} onClick={() => { if (type === item.value) return; setType(item.value); setEntryPath(''); setToken(''); setPassword('') }}><item.icon size={16} />{item.label}</button>)}</div>
    <form className="source-form" onSubmit={event => void submit(event)}>
      {type === 'github' && <><label>GitHub 仓库<input required value={repository} onChange={e => setRepository(e.target.value.trim())} placeholder="owner/repository" autoComplete="off" /></label><label>分支、标签或 commit<input value={ref} onChange={e => setRef(e.target.value)} placeholder="默认分支" autoComplete="off" /></label></>}
      {type === 'webdav' && <label className="source-wide">WebDAV 根目录<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://dav.example.com/ledger/" autoComplete="off" /></label>}
      <label className="source-wide">{type === 'local' ? '本机入口文件路径' : '入口文件相对路径'}<input required value={entryPath} onChange={e => setEntryPath(e.target.value)} placeholder={type === 'local' ? '/Users/你/账本/main.beancount' : 'books/main.beancount'} autoComplete="off" /></label>
      {type === 'webdav' && <><label>用户名（可选）<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label><label>密码（可选）<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label></>}
      {type !== 'local' && <label className="source-wide">{type === 'github' ? 'Token（私有仓库必填）' : 'Bearer Token（与密码二选一）'}<input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={hasCredentials ? '已保存凭证' : type === 'github' ? '公开仓库可留空' : '可选'} autoComplete="new-password" /></label>}
      {hasCredentials && <label className="source-check source-wide"><input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} /><span>沿用已保存的凭证</span></label>}
      <details className="disclosure source-wide"><summary>高级选项{allowPlugins ? ' · 已允许插件' : ''}</summary><div className="disclosure-content"><label className="source-check plugin-trust"><input type="checkbox" checked={allowPlugins} onChange={e => setAllowPlugins(e.target.checked)} /><span>允许可信的 Python 插件<small>插件可读写本机文件或联网，仅为可信账本开启。</small></span></label>{status?.connected && <div className="source-hint"><p>{status.fileCount} 个文件 · {status.transactionCount} 笔交易 · Beancount {status.engineVersion ?? '3'}</p><p>{status.loadedAt ? `读取于 ${new Date(status.loadedAt).toLocaleString('zh-CN')}` : ''}{status.revision ? ` · ${status.revision.slice(0, 12)}` : ''}</p></div>}</div></details>
      <div className="setting-actions source-wide"><button className="button button-primary" disabled={busy || backendAvailable !== true} type="submit">{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? '校验中…' : '连接账本'}</button>{status?.configured && <button className="button" disabled={busy || !backendAvailable} type="button" onClick={() => void reload()}><RefreshCw size={15} />重新读取</button>}<button className="button" disabled={busy} type="button" onClick={() => void useDemo()}><Unplug size={15} />使用演示账本</button></div>
    </form>
    {error && <div className="source-error" role="alert"><strong>账本加载失败</strong><p>{error.message}</p>{status?.connected && <p>仍显示上次成功读取的数据。</p>}{error.diagnostics?.length ? <ul>{error.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ''} {diagnostic.message}</li>)}</ul> : null}</div>}
  </section>
}
