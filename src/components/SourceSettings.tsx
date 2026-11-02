import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Cloud, FolderOpen, Github, LoaderCircle, RefreshCw, Unplug } from 'lucide-react'
import type { ConnectRequest, SourceConfig } from '../domain/source-types'
import type { LedgerSourceController } from '../hooks/useLedgerSource'

export default function SourceSettings({ controller }: { controller: LedgerSourceController }) {
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
    <div className="section-heading"><div><h2>连接真实账本</h2><p>选择入口文件，官方 Beancount 会读取所有 include 并完整校验。</p></div><FolderOpen size={21} className="settings-heading-icon" /></div>
    {backendAvailable === false && <div className="source-notice">当前页面未连接加载后端。请在项目目录运行 <code>npm run dev</code>（开发）或 <code>npm run build &amp;&amp; npm start</code>（本机使用）。静态 Cloudflare 预览无法直接读取你电脑上的文件。</div>}
    {status?.connected && <div className="source-connected"><Check size={18} /><div><strong>真实账本已完整加载</strong><p>{status.source?.type === 'local' ? '本地' : status.source?.type === 'github' ? 'GitHub' : 'WebDAV'} · {status.source?.entryPath}</p><p>{status.fileCount} 个文件 · {status.transactionCount} 笔交易 · Beancount {status.engineVersion ?? '3'}</p><p>{status.loadedAt ? new Date(status.loadedAt).toLocaleString('zh-CN') : ''}{status.revision ? ` · ${status.revision.slice(0, 12)}` : ''}</p></div></div>}
    <div className="segmented source-tabs" aria-label="账本数据源类型">{([{ value: 'local', label: '本地目录', icon: FolderOpen }, { value: 'github', label: 'GitHub', icon: Github }, { value: 'webdav', label: 'WebDAV', icon: Cloud }] as const).map(item => <button key={item.value} type="button" aria-pressed={type === item.value} disabled={busy} onClick={() => { if (type === item.value) return; setType(item.value); setEntryPath(''); setToken(''); setPassword('') }}><item.icon size={16} />{item.label}</button>)}</div>
    <form className="source-form" onSubmit={event => void submit(event)}>
      {type === 'github' && <><label>GitHub 仓库<input required value={repository} onChange={e => setRepository(e.target.value.trim())} placeholder="owner/repository" autoComplete="off" /></label><label>分支、标签或 commit<input value={ref} onChange={e => setRef(e.target.value)} placeholder="留空使用仓库默认分支" autoComplete="off" /></label></>}
      {type === 'webdav' && <label className="source-wide">WebDAV 根目录 URL<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://dav.example.com/ledger/" autoComplete="off" /></label>}
      <label className="source-wide">{type === 'local' ? '账本入口文件的本机路径' : '入口文件相对路径'}<input required value={entryPath} onChange={e => setEntryPath(e.target.value)} placeholder={type === 'local' ? '/Users/你/账本/main.beancount' : 'books/main.beancount'} autoComplete="off" /></label>
      <p className="source-hint source-wide">{type === 'local' ? '账本保留在原目录，无需复制到项目中；支持相对、绝对路径及多层目录的 include。' : '保留远程根目录的文件结构，支持同一仓库或 WebDAV 根目录内跨目录、嵌套及通配符 include。'}</p>
      {type === 'webdav' && <><label>用户名（可选）<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label><label>密码（可选）<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" /></label></>}
      {type !== 'local' && <label className="source-wide">{type === 'github' ? '访问 Token（私有仓库必填）' : 'Bearer Token（可选，与用户名密码二选一）'}<input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={hasCredentials ? '本机已保存凭证，刷新无需重新输入' : '仅发送给对应的数据源服务'} autoComplete="new-password" /></label>}
      {hasCredentials && <label className="source-check source-wide"><input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} /><span>沿用当前数据源在本机已保存的凭证</span></label>}
      <label className="source-check source-wide plugin-trust"><input type="checkbox" checked={allowPlugins} onChange={e => setAllowPlugins(e.target.checked)} /><span>信任并允许账本中的 Python 插件<small>插件会执行代码，可以读写运行服务机器上的文件或联网。只为你信任的账本开启。</small></span></label>
      <div className="setting-actions source-wide"><button className="button button-primary" disabled={busy || backendAvailable !== true} type="submit">{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? '正在获取文件并完整校验…' : '连接并校验账本'}</button>{status?.configured && <button className="button" disabled={busy || !backendAvailable} type="button" onClick={() => void reload()}><RefreshCw size={15} />重新读取</button>}<button className="button" disabled={busy} type="button" onClick={() => void useDemo()}><Unplug size={15} />使用演示账本</button></div>
      <p className="source-hint source-wide">配置与凭证只保存在本机的私有配置文件中，不写入账本、不进入 Git，也不会缓存到 PWA。</p>
    </form>
    {error && <div className="source-error" role="alert"><strong>未加载新账本</strong><p>{error.message}</p>{status?.connected && <p>仍在展示上一次成功加载的快照，请先修复错误再重新读取。</p>}{error.diagnostics?.length ? <ul>{error.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ''} {diagnostic.message}</li>)}</ul> : null}</div>}
  </section>
}
