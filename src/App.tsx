import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, CircleHelp, Eye, EyeOff, Github, LayoutDashboard, ListFilter, Settings2, Wallet, WifiOff, X } from 'lucide-react'
import { loadDemoLedger, getOverview } from './domain'
import { DisplayContext } from './components/ui'
import OverviewPage from './pages/OverviewPage'
import TransactionsPage from './pages/TransactionsPage'
import AccountsPage from './pages/AccountsPage'
import SettingsPage from './pages/SettingsPage'
import { monthLabel, shiftMonth } from './lib/format'
import { routeHref, useRoute } from './lib/route'
import type { Page } from './lib/route'
import { usePwa } from './hooks/usePwa'

const ledger = loadDemoLedger()
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
  const { route, navigate } = useRoute(ledger.defaultMonth)
  const [hidden, setHidden] = useState(() => readPreference('privacy', 'false') === 'true')
  const [currency, setCurrency] = useState(() => readPreference('currency', 'CNY'))
  const [theme, setTheme] = useState(() => readPreference('theme', 'dark'))
  const [sourceOpen, setSourceOpen] = useState(false)
  const pwa = usePwa()
  const overview = getOverview(ledger, route.month, currency)
  const active = navigation.find(item => item.page === route.page)!

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
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
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSourceOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [sourceOpen])

  const go = (page: Page, filters = {}) => navigate({ page, kind: 'all', search: '', account: '', ...filters })
  const pageContent = route.page === 'overview'
    ? <OverviewPage ledger={ledger} month={route.month} currency={currency} onNavigate={go} />
    : route.page === 'transactions'
      ? <TransactionsPage ledger={ledger} route={route} currency={currency} onFilter={navigate} />
      : route.page === 'accounts'
        ? <AccountsPage ledger={ledger} month={route.month} currency={currency} onAccount={account => go('transactions', { account })} />
        : <SettingsPage ledger={ledger} theme={theme} onTheme={setTheme} hidden={hidden} onPrivacy={setHidden} onSource={() => setSourceOpen(true)} />

  return <DisplayContext.Provider value={{ hidden, currency }}>
    <div className="app-shell">
      <a className="skip-link" href="#page-main">跳到主要内容</a>
      <aside className="sidebar">
        <a className="brand" href={routeHref('overview', route.month)} aria-label="Countwell 首页"><span className="brand-mark">c<span>.</span></span><span>countwell<span className="brand-dot">.</span></span></a>
        <div className="sidebar-caption">我的财务空间</div>
        <nav className="nav-list" aria-label="主要导航">{navigation.map(item => <a key={item.page} href={routeHref(item.page, route.month)} className={`nav-link ${route.page === item.page ? 'active' : ''}`} aria-current={route.page === item.page ? 'page' : undefined}><item.icon className="nav-icon" size={19} strokeWidth={1.7} /><span>{item.title}</span>{route.page === item.page && <span className="nav-active-dot" />}</a>)}</nav>
        <div className="sidebar-footer"><button className="source-card" onClick={() => setSourceOpen(true)}><div className="source-card-top"><BookOpen size={17} /><ArrowUpRight size={15} /></div><strong>我的生活账本</strong><span className="source-status"><span />演示账本 · 本地只读</span></button><p className="sidebar-note">账本属于你，<br />每一笔都有迹可循。</p><span className="version-label">COUNTWELL · DEMO 0.1</span></div>
      </aside>
      <main className="main-content" id="page-main">
        <div className="topbar"><a className="mobile-brand" href={routeHref('overview', route.month)}><span className="brand-mark">c<span>.</span></span><span>countwell.</span></a><div className="topbar-meta">我的生活账本 <ChevronRight size={13} /> <span>{active.title}</span></div><div className="topbar-actions"><span className="demo-badge"><span />演示数据</span><select className="currency-picker" aria-label="展示币种" value={currency} onChange={e => setCurrency(e.target.value)}>{Array.from(new Set(['CNY', 'USD', ...overview.currencies])).map(c => <option key={c} value={c}>{c}</option>)}</select><button className="icon-button" onClick={() => setHidden(v => !v)} aria-label={hidden ? '显示金额' : '隐藏金额'} aria-pressed={hidden}>{hidden ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></div>
        <div className="page-content">
          {pwa.offline && <div className="notice"><WifiOff size={17} /><span>当前离线，正在查看已保存的演示账本。</span></div>}
          {pwa.updateAvailable && <div className="notice"><span>新版本已准备好。</span><button className="text-action" onClick={() => pwa.applyUpdate()}>刷新更新 <ArrowUpRight size={15} /></button></div>}
          <header className="page-header"><div><p className="page-eyebrow">{route.page === 'overview' ? 'A LITTLE CLARITY, EVERY DAY' : route.page === 'accounts' ? 'YOUR MONEY, AT A GLANCE' : route.page === 'transactions' ? 'EVERY LITTLE MOMENT' : 'MAKE IT YOURS'}</p><h1 className="screen-heading">{active.title}</h1><p className="page-subtitle">{route.page === 'overview' ? '看清钱的来处，也了解生活的去向。' : route.page === 'transactions' ? '消费、收入、退款与转账，清清楚楚。' : route.page === 'accounts' ? '手头的钱、投资和欠款，都在这里。' : '用你习惯的方式，和自己的账本相处。'}</p></div>{route.page !== 'settings' && <div className="month-control"><button className="icon-button" aria-label="上个月" onClick={() => navigate({ month: shiftMonth(route.month, -1) })}><ChevronLeft size={17} /></button><label className="month-label"><span>{monthLabel(route.month)}</span><input type="month" className="month-input" aria-label="查询月份" value={route.month} min="1900-01" max="9998-12" onChange={e => { if (e.target.value) navigate({ month: e.target.value }) }} /></label><button className="icon-button" aria-label="下个月" onClick={() => navigate({ month: shiftMonth(route.month, 1) })}><ChevronRight size={17} /></button></div>}</header>
          {pageContent}
          <footer className="page-footer"><span><span className="footer-dot" />虚构演示账本 · 截至所选月末</span><button onClick={() => setSourceOpen(true)}>由 Beancount 纯文本账本驱动 <ArrowUpRight size={13} /></button></footer>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="手机导航">{navigation.map(item => <a key={item.page} className={`mobile-nav-item ${route.page === item.page ? 'active' : ''}`} aria-current={route.page === item.page ? 'page' : undefined} href={routeHref(item.page, route.month)}><item.icon size={21} strokeWidth={1.8} /><span>{item.short}</span></a>)}</nav>
      {sourceOpen && <div className="modal-backdrop" onClick={() => setSourceOpen(false)}><section className="drawer source-drawer" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={e => e.stopPropagation()}><header className="drawer-header"><div><p className="page-eyebrow">PLAIN TEXT, ALWAYS YOURS</p><h2 id="source-title">我的生活账本</h2></div><button className="icon-button" autoFocus onClick={() => setSourceOpen(false)} aria-label="关闭账本原文"><X size={20} /></button></header><div className="source-explanation"><Github size={18} /><p>这份虚构 Beancount 文本是 demo 的数据来源。未来可从你的 GitHub 私有仓库读取；当前没有连接任何远程仓库。</p></div>{hidden ? <div className="empty-state"><EyeOff size={24} /><p>金额隐藏中。关闭隐私模式后可查看账本原文。</p><button className="button" onClick={() => setHidden(false)}>显示金额</button></div> : <pre className="source-code">{ledger.source}</pre>}<div className="drawer-footer"><CircleHelp size={15} /><span>原文保留复式记账符号，日常页面按财务含义显示。</span></div></section></div>}
      <span className="sr-only" aria-live="polite">{hidden ? '金额已隐藏' : ''}</span>
    </div>
  </DisplayContext.Provider>
}
