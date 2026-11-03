import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Eye, EyeOff, LayoutDashboard, ListFilter, Settings2, Wallet, WifiOff, X } from 'lucide-react'
import { getOverview } from './domain'
import { DisplayContext, EmptyState } from './components/ui'
import OverviewPage from './pages/OverviewPage'
import TransactionsPage from './pages/TransactionsPage'
import AccountsPage from './pages/AccountsPage'
import SettingsPage from './pages/SettingsPage'
import { monthLabel, shiftMonth } from './lib/format'
import { routeHref, useRoute } from './lib/route'
import type { Page } from './lib/route'
import { usePwa } from './hooks/usePwa'
import { useLedgerSource } from './hooks/useLedgerSource'
import { cloudMode } from './lib/runtime'
import BrandIcon from './components/BrandIcon'

const navigation = [
  { page: 'overview', title: '收支总览', short: '总览', icon: LayoutDashboard },
  { page: 'transactions', title: '交易记录', short: '交易', icon: ListFilter },
  { page: 'accounts', title: '账户与资产', short: '账户', icon: Wallet },
  { page: 'settings', title: '偏好与账本', short: '设置', icon: Settings2 },
] as const

function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(`countwell.${key}`) ?? fallback } catch { return fallback }
}

export default function App() {
  const sourceController = useLedgerSource()
  const { ledger } = sourceController
  const sourceFiles = ledger.files?.length ? ledger.files : [{ path: 'demo.beancount', content: ledger.source }]
  const [sourceFileIndex, setSourceFileIndex] = useState(0)
  const sourceIdentity = useRef('')
  const { route, navigate } = useRoute(ledger.defaultMonth)
  const [hidden, setHidden] = useState(() => readPreference('privacy', 'false') === 'true')
  const [currency, setCurrency] = useState(() => readPreference('currency', 'CNY'))
  const [theme, setTheme] = useState(() => readPreference('theme', 'dark'))
  const [sourceOpen, setSourceOpen] = useState(false)
  const sourceTrigger = useRef<HTMLElement | null>(null)
  const openSource = () => { sourceTrigger.current = document.activeElement as HTMLElement; setSourceOpen(true) }
  const pwa = usePwa()
  const overview = getOverview(ledger, route.month, currency)
  const active = navigation.find(item => item.page === route.page)!
  useEffect(() => {
    if (!sourceController.real) { sourceIdentity.current = ''; return }
    if (!sourceController.status?.source) return
    const source = sourceController.status.source
    // A cloud snapshot changes commit refs while the selected ledger stays the same.
    const identity = JSON.stringify(cloudMode ? { type: source.type, repository: source.repository, entryPath: source.entryPath } : source)
    if (sourceIdentity.current !== identity) {
      sourceIdentity.current = identity
      navigate({ month: ledger.defaultMonth, account: '', search: '', kind: 'all' })
      if (!overview.currencies.includes(currency)) setCurrency(ledger.operatingCurrencies?.[0] ?? overview.currencies[0] ?? 'CNY')
    }
    setSourceFileIndex(0)
  }, [sourceController.status?.snapshotId, sourceController.real])

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f5f0' : '#121413')
    try { localStorage.setItem('countwell.theme', theme) } catch { /* Preferences are optional. */ }
  }, [theme])
  useEffect(() => {
    try {
      localStorage.setItem('countwell.privacy', String(hidden))
      localStorage.setItem('countwell.currency', currency)
    } catch { /* The ledger is never stored in browser storage. */ }
  }, [hidden, currency])
  useEffect(() => { document.title = `${active.title} · ${monthLabel(route.month)} · Countwell` }, [active.title, route.month])
  useEffect(() => {
    if (!sourceOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSourceOpen(false)
      if (event.key === 'Tab') {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('.source-drawer button:not(:disabled), .source-drawer a[href], .source-drawer input, .source-drawer select'))
        const first = elements[0], last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.body.style.overflow = previousOverflow
      sourceTrigger.current?.focus()
    }
  }, [sourceOpen])

  const go = (page: Page, filters = {}) => navigate({ page, kind: 'all', search: '', account: '', ...filters })
  const pageContent = sourceController.needsConnection && route.page !== 'settings'
    ? cloudMode
      ? <EmptyState title={sourceController.backendAvailable === null ? '正在读取账本' : '账本暂不可用'} action={sourceController.backendAvailable !== null && <button className="button" onClick={() => void sourceController.refreshStatus()}>重试</button>} />
      : <EmptyState title="尚未连接账本" action={<button className="button" onClick={() => go('settings')}>连接账本</button>} />
    : route.page === 'overview'
    ? <OverviewPage ledger={ledger} month={route.month} currency={currency} onNavigate={go} />
    : route.page === 'transactions'
      ? <TransactionsPage ledger={ledger} route={route} currency={currency} onFilter={navigate} />
      : route.page === 'accounts'
        ? <AccountsPage ledger={ledger} month={route.month} currency={currency} onAccount={account => go('transactions', { account })} />
        : <SettingsPage ledger={ledger} theme={theme} onTheme={setTheme} hidden={hidden} onPrivacy={setHidden} onSource={openSource} controller={sourceController} />

  return <DisplayContext.Provider value={{ hidden, currency }}>
    <div className="app-shell">
      <a className="skip-link" href="#page-main" onClick={event => { event.preventDefault(); document.getElementById('page-main')?.focus() }}>跳到主要内容</a>
      <aside className="sidebar">
        <a className="brand" href={routeHref('overview', route.month)} aria-label="Countwell 首页"><span className="brand-mark"><BrandIcon /></span></a>
        <nav className="nav-list" aria-label="主要导航">{navigation.map(item => <a key={item.page} href={routeHref(item.page, route.month)} className={`nav-link ${route.page === item.page ? 'active' : ''}`} aria-current={route.page === item.page ? 'page' : undefined}><item.icon className="nav-icon" size={19} strokeWidth={1.7} /><span>{item.title}</span>{route.page === item.page && <span className="nav-active-dot" />}</a>)}</nav>
        <div className="sidebar-footer"><button className="source-card" onClick={openSource}><div className="source-card-top"><BookOpen size={17} /><ArrowUpRight size={15} /></div><strong>{ledger.title}</strong><span className="source-status"><span />{sourceController.real ? '真实账本 · 只读' : cloudMode ? '正在读取' : '演示账本'}</span></button></div>
      </aside>
      <main className="main-content" id="page-main" tabIndex={-1}>
        <div className="topbar"><a className="mobile-brand" href={routeHref('overview', route.month)} aria-label="Countwell 首页"><span className="brand-mark"><BrandIcon /></span></a><div className="topbar-meta">{ledger.title} <ChevronRight size={13} /> <span>{active.title}</span></div><div className="topbar-actions"><span className="demo-badge"><span />{sourceController.real ? '真实账本' : sourceController.needsConnection ? '尚未加载' : '演示数据'}</span><select className="currency-picker" aria-label="展示币种" value={currency} onChange={e => setCurrency(e.target.value)}>{Array.from(new Set([...overview.currencies, currency])).map(c => <option key={c} value={c}>{c}</option>)}</select><button className="icon-button" onClick={() => setHidden(v => !v)} aria-label={hidden ? '显示金额' : '隐藏金额'} aria-pressed={hidden}>{hidden ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>
        <div className="page-content">
          {pwa.offline && <div className="notice"><WifiOff size={17} /><span>{sourceController.real ? '当前离线 · 显示已加载账本' : '当前离线 · 演示账本可用'}</span></div>}
          {sourceController.real && sourceController.backendAvailable === false && <div className="notice"><span>连接中断，显示上次加载的账本。</span><button className="text-action" onClick={() => go('settings')}>检查连接</button></div>}
          {sourceController.error && sourceController.real && <div className="notice source-error"><span>更新失败，显示上次加载的账本。</span><button className="text-action" onClick={() => go('settings')}>查看错误</button></div>}
          {pwa.updateAvailable && <div className="notice"><span>新版本已准备好。</span><button className="text-action" onClick={() => pwa.applyUpdate()}>刷新更新 <ArrowUpRight size={15} /></button></div>}
          <header className="page-header"><h1 className="screen-heading">{active.title}</h1>{route.page !== 'settings' && <div className="month-control"><button className="icon-button" aria-label="上个月" onClick={() => navigate({ month: shiftMonth(route.month, -1) })}><ChevronLeft size={17} /></button><label className="month-label"><span>{monthLabel(route.month)}</span><input type="month" className="month-input" aria-label="查询月份" value={route.month} min="1900-01" max="9998-12" onChange={e => { if (e.target.value) navigate({ month: e.target.value }) }} /></label><button className="icon-button" aria-label="下个月" onClick={() => navigate({ month: shiftMonth(route.month, 1) })}><ChevronRight size={17} /></button></div>}</header>
          {pageContent}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="手机导航">{navigation.map(item => <a key={item.page} className={`mobile-nav-item ${route.page === item.page ? 'active' : ''}`} aria-current={route.page === item.page ? 'page' : undefined} href={routeHref(item.page, route.month)}><item.icon size={22} strokeWidth={1.8} aria-hidden="true" /><span>{item.short}</span></a>)}</nav>
      {sourceOpen && <div className="modal-backdrop" onClick={() => setSourceOpen(false)}><section className="drawer source-drawer" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={e => e.stopPropagation()}><header className="drawer-header"><h2 id="source-title">{ledger.title}</h2><button className="icon-button" autoFocus onClick={() => setSourceOpen(false)} aria-label="关闭账本原文"><X size={20} /></button></header>{sourceFiles.length > 1 && <label className="source-file-selector">账本源文件<select aria-label="账本源文件" value={sourceFileIndex} onChange={event => setSourceFileIndex(Number(event.target.value))}>{sourceFiles.map((file, index) => <option key={file.path} value={index}>{file.path}</option>)}</select></label>}{hidden ? <div className="empty-state"><EyeOff size={24} /><p>金额已隐藏</p><button className="button" onClick={() => setHidden(false)}>显示金额</button></div> : <pre className="source-code">{sourceFiles[sourceFileIndex]?.content ?? ledger.source}</pre>}</section></div>}
      <span className="sr-only" aria-live="polite">{hidden ? '金额已隐藏' : ''}</span>
    </div>
  </DisplayContext.Provider>
}
