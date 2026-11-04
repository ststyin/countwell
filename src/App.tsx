import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Eye, EyeOff, LayoutDashboard, ListFilter, Settings2, Wallet, WifiOff, X } from 'lucide-react'
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
import ThemeControl from './components/ThemeControl'
import { useTheme } from './hooks/useTheme'
import { useBillingCycle } from './hooks/useBillingCycle'
import { useStartupNavigation } from './hooks/useStartupNavigation'
import { billingMonthForDate, reportPeriod } from './domain'
import type { SourceSnapshot } from './lib/source-client'

const navigation = [
  { page: 'overview', title: '收支总览', short: '总览', icon: LayoutDashboard },
  { page: 'transactions', title: '交易记录', short: '交易', icon: ListFilter },
  { page: 'accounts', title: '账户与资产', short: '账户', icon: Wallet },
  { page: 'settings', title: '偏好与账本', short: '设置', icon: Settings2 },
] as const

function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(`countwell.${key}`) ?? fallback } catch { return fallback }
}

export default function App({ initialCloudSnapshot, cloudNavigationReady }: { initialCloudSnapshot?: SourceSnapshot; cloudNavigationReady?: boolean }) {
  const sourceController = useLedgerSource(initialCloudSnapshot)
  const { ledger } = sourceController
  const sourceFiles = ledger.files?.length ? ledger.files : [{ path: 'demo.beancount', content: ledger.source }]
  const [sourceFileIndex, setSourceFileIndex] = useState(0)
  const sourceIdentity = useRef('')
  const { cycle, setCycle } = useBillingCycle()
  const latestDate = ledger.transactions.reduce((latest, transaction) => transaction.date > latest ? transaction.date : latest, '') || `${ledger.defaultMonth}-01`
  const defaultMonth = cycle.mode === 'calendar' ? ledger.defaultMonth : billingMonthForDate(latestDate, cycle)
  const { route, navigate } = useRoute(defaultMonth)
  const [hidden, setHidden] = useState(() => readPreference('privacy', 'false') === 'true')
  const currency = 'CNY'
  const { preference, setPreference } = useTheme()
  useEffect(() => { try { localStorage.removeItem('countwell.viewportDiagnostics') } catch { /* The temporary diagnostic preference is optional. */ } }, [])
  const period = reportPeriod(route.month, cycle)
  const datedPage = route.page === 'overview' || route.page === 'transactions'
  const [sourceOpen, setSourceOpen] = useState(false)
  const sourceTrigger = useRef<HTMLElement | null>(null)
  const openSource = () => { sourceTrigger.current = document.activeElement as HTMLElement; setSourceOpen(true) }
  const pwa = usePwa()
  const localNavigationReady = useStartupNavigation(pwa.ios && pwa.isStandalone && cloudNavigationReady === undefined, sourceController.initialLoading, Boolean(initialCloudSnapshot))
  const navigationReady = cloudNavigationReady ?? localNavigationReady
  const active = navigation.find(item => item.page === route.page)!
  useEffect(() => {
    if (!sourceController.real) { sourceIdentity.current = ''; return }
    if (!sourceController.status?.source) return
    const source = sourceController.status.source
    // A cloud snapshot changes commit refs while the selected ledger stays the same.
    const identity = JSON.stringify(cloudMode ? { type: source.type, repository: source.repository, entryPath: source.entryPath } : source)
    if (sourceIdentity.current !== identity) {
      const initialCloudSource = cloudMode && sourceIdentity.current === ''
      sourceIdentity.current = identity
      if (initialCloudSource) {
        const explicitMonth = new URLSearchParams(window.location.hash.split('?')[1]).get('month')
        // Loading the private snapshot must not overwrite a linked report period.
        if (!explicitMonth || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(explicitMonth)) navigate({ month: defaultMonth })
      } else navigate({ month: defaultMonth, account: '', search: '', kind: 'all', allTime: false, date: undefined, section: undefined, cardCurrency: undefined, paymentCurrency: undefined })
    }
    setSourceFileIndex(0)
  }, [sourceController.status?.snapshotId, sourceController.real])

  useEffect(() => {
    try {
      localStorage.setItem('countwell.privacy', String(hidden))
    } catch { /* The ledger is never stored in browser storage. */ }
  }, [hidden])
  useEffect(() => { document.title = `${active.title}${datedPage ? ` · ${route.allTime && route.page === 'transactions' ? '全部时间' : monthLabel(route.month)}` : ''} · Countwell` }, [active.title, route.month, datedPage, route.allTime])
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

  const go = (page: Page, filters = {}) => navigate({ page, kind: 'all', search: '', account: '', allTime: false, date: undefined, section: undefined, cardCurrency: undefined, paymentCurrency: undefined, ...filters })
  const pageContent = sourceController.needsConnection && route.page !== 'settings'
    ? cloudMode
      ? <EmptyState title={sourceController.initialLoading ? '正在读取账本' : '账本暂不可用'} action={sourceController.initialLoading ? !navigationReady && <button className="button" onClick={() => go('settings')}>前往设置</button> : <button className="button" onClick={() => void sourceController.refreshStatus()}>重试</button>} />
      : <EmptyState title="尚未连接账本" action={<button className="button" onClick={() => go('settings')}>连接账本</button>} />
    : route.page === 'overview'
    ? <OverviewPage ledger={ledger} month={route.month} currency={currency} cycle={cycle} onNavigate={go} />
    : route.page === 'transactions'
      ? <TransactionsPage ledger={ledger} route={route} currency={currency} cycle={cycle} onFilter={navigate} />
      : route.page === 'accounts'
        ? <AccountsPage ledger={ledger} currency={currency} section={route.section} onAccount={account => go('transactions', { account, allTime: true })} />
        : <SettingsPage ledger={ledger} month={route.month} cycle={cycle} onCycle={setCycle} hidden={hidden} onSource={openSource} controller={sourceController} />

  return <DisplayContext.Provider value={{ hidden, currency }}>
    <div className={`app-shell${sourceOpen ? ' drawer-open' : ''}`}>
      <a className="skip-link" href="#page-main" onClick={event => { event.preventDefault(); document.getElementById('page-main')?.focus() }}>跳到主要内容</a>
      <aside className="sidebar">
        <a className="brand" href={routeHref('overview', route.month)} aria-label="Countwell 首页"><span className="brand-mark"><BrandIcon /></span></a>
        <nav className="nav-list" aria-label="主要导航">{navigation.map(item => <a key={item.page} href={routeHref(item.page, route.month)} className={`nav-link ${route.page === item.page ? 'active' : ''}`} aria-current={route.page === item.page ? 'page' : undefined}><item.icon className="nav-icon" size={19} strokeWidth={1.7} /><span>{item.title}</span>{route.page === item.page && <span className="nav-active-dot" />}</a>)}</nav>
        <div className="sidebar-footer"><button className="source-card" onClick={openSource}><div className="source-card-top"><BookOpen size={17} /><ArrowUpRight size={15} /></div><strong>{ledger.title}</strong><span className="source-status"><span />{sourceController.real ? '已同步' : cloudMode ? '正在读取' : '演示账本'}</span></button></div>
      </aside>
      <main className="main-content" id="page-main" tabIndex={-1}>
        <div className="topbar"><a className="mobile-brand" href={routeHref('overview', route.month)} aria-label="Countwell 首页"><span className="brand-mark"><BrandIcon /></span></a><div className="topbar-meta">{ledger.title}</div><div className="topbar-actions">{!sourceController.real && <span className="demo-badge"><span />{sourceController.needsConnection ? '尚未加载' : '演示数据'}</span>}<ThemeControl preference={preference} onChange={setPreference} /><button className="icon-button" onClick={() => setHidden(v => !v)} aria-label={hidden ? '显示金额' : '隐藏金额'} aria-pressed={hidden}>{hidden ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>
        <div className="page-content">
          {pwa.offline && <div className="notice"><WifiOff size={17} /><span>离线 · 当前账本</span></div>}
          {sourceController.real && sourceController.backendAvailable === false && <div className="notice"><span>连接中断 · 保留上次数据</span><button className="text-action" onClick={() => go('settings')}>检查连接</button></div>}
          {sourceController.error && sourceController.real && <div className="notice source-error"><span>更新失败 · 保留上次数据</span><button className="text-action" onClick={() => go('settings')}>查看错误</button></div>}
          {pwa.updateAvailable && <div className="notice update-notice"><span>有可用更新</span><button className="text-action" onClick={() => pwa.applyUpdate()}>更新 <ArrowUpRight size={15} /></button></div>}
          <header className="page-header"><h1 className="screen-heading">{active.title}</h1>{datedPage && <div className="period-control">{route.page === 'transactions' && <button className="period-scope" aria-pressed={Boolean(route.allTime)} onClick={() => navigate({ allTime: !route.allTime, date: undefined })}>{route.allTime ? '全部时间' : '全部'}</button>}{!(route.page === 'transactions' && route.allTime) && <><div className="month-control"><button className="icon-button" aria-label="上个月" onClick={() => navigate({ month: shiftMonth(route.month, -1), date: undefined })}><ChevronLeft size={15} /></button><label className="month-label"><span>{route.month.replace('-', '.')}</span><input type="month" className="month-input" aria-label="查询月份" value={route.month} min="1900-01" max="9998-12" onChange={e => { if (e.target.value) navigate({ month: e.target.value, date: undefined }) }} /></label><button className="icon-button" aria-label="下个月" onClick={() => navigate({ month: shiftMonth(route.month, 1), date: undefined })}><ChevronRight size={15} /></button></div>{cycle.mode !== 'calendar' && <span className="period-range">{period.start.slice(5).replace('-', '.')}–{period.end.slice(5).replace('-', '.')}</span>}</>}</div>}</header>
          {pageContent}
        </div>
      </main>
      {navigationReady && <nav className="mobile-nav" aria-label="手机导航">{navigation.map(item => <a key={item.page} className={`mobile-nav-item ${route.page === item.page ? 'active' : ''}`} aria-current={route.page === item.page ? 'page' : undefined} href={routeHref(item.page, route.month)}><item.icon size={22} strokeWidth={1.8} aria-hidden="true" /><span>{item.short}</span></a>)}</nav>}
      {sourceOpen && <div className="modal-backdrop" onClick={() => setSourceOpen(false)}><section className="drawer source-drawer" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={e => e.stopPropagation()}><header className="drawer-header"><h2 id="source-title">{ledger.title}</h2><button className="icon-button" autoFocus onClick={() => setSourceOpen(false)} aria-label="关闭账本原文"><X size={20} /></button></header>{sourceFiles.length > 1 && <label className="source-file-selector">账本源文件<select aria-label="账本源文件" value={sourceFileIndex} onChange={event => setSourceFileIndex(Number(event.target.value))}>{sourceFiles.map((file, index) => <option key={file.path} value={index}>{file.path}</option>)}</select></label>}{hidden ? <div className="empty-state"><EyeOff size={24} /><p>金额已隐藏</p><button className="button" onClick={() => setHidden(false)}>显示金额</button></div> : <pre className="source-code">{sourceFiles[sourceFileIndex]?.content ?? ledger.source}</pre>}</section></div>}
      <span className="sr-only" aria-live="polite">{hidden ? '金额已隐藏' : ''}</span>
    </div>
  </DisplayContext.Provider>
}
