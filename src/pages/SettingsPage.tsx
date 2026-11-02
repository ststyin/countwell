import { useState } from 'react'
import { ArrowUpRight, BookOpen, Check, Download, Laptop, Moon, ShieldCheck, Smartphone, Sun, WifiOff } from 'lucide-react'
import { usePwa } from '../hooks/usePwa'
import type { Ledger } from '../domain/types'
import { zipSync, strToU8 } from 'fflate'
import SourceSettings from '../components/SourceSettings'
import type { LedgerSourceController } from '../hooks/useLedgerSource'

export default function SettingsPage({ ledger, theme, onTheme, hidden, onPrivacy, onSource, controller }: { ledger: Ledger; theme: string; onTheme: (theme: string) => void; hidden: boolean; onPrivacy: (hidden: boolean) => void; onSource: () => void; controller: LedgerSourceController }) {
  const pwa = usePwa()
  const [message, setMessage] = useState('')
  const files = ledger.files?.length ? ledger.files : [{ path: 'demo.beancount', content: ledger.source }]
  const download = () => {
    const multiple = files.length > 1
    const data = multiple ? zipSync(Object.fromEntries(files.map(file => [file.path, strToU8(file.content)])), { level: 1 }) : null
    const blob = data ? new Blob([new Uint8Array(data).buffer], { type: 'application/zip' }) : new Blob([files[0].content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = multiple ? 'countwell-ledger-files.zip' : files[0].path.split('/').at(-1) ?? 'main.beancount'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(multiple ? '已导出加载的账本源文件，保留相对目录结构；不含附件、配置凭证或插件程序。' : '已导出账本原文。')
  }
  return <div className="settings-layout">
    <SourceSettings controller={controller} />
    <section className="panel settings-section"><div className="section-heading"><div><h2>按你的习惯来</h2><p>舒服的界面，看钱也轻松一点。</p></div><Laptop size={20} className="settings-heading-icon" /></div><div className="setting-row"><div><strong>界面外观</strong><p>深色或浅色，由你决定。</p></div><div className="segmented"><button aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}><Moon size={15} />深色</button><button aria-pressed={theme === 'light'} onClick={() => onTheme('light')}><Sun size={15} />浅色</button></div></div><div className="setting-row"><div><strong>隐藏金额</strong><p>在公共场合也能安心查看。</p></div><button className={`toggle ${hidden ? 'on' : ''}`} role="switch" aria-checked={hidden} aria-label="隐藏金额" onClick={() => onPrivacy(!hidden)}><span /></button></div></section>
    <section className="panel settings-section pwa-settings"><div className="section-heading"><div><h2>把账本放进口袋</h2><p>添加到主屏幕，像 App 一样打开。</p></div><Smartphone size={21} className="settings-heading-icon" /></div><div className="pwa-feature-row"><span><Check size={15} />手机与电脑适配</span><span><WifiOff size={15} />{pwa.offlineReady ? '离线演示已就绪' : '首次联网后准备离线演示'}</span></div>{pwa.isStandalone || pwa.installed ? <div className="install-state"><Check size={17} />已作为应用打开或安装</div> : pwa.installAvailable ? <button className="button button-primary" onClick={async () => { const result = await pwa.install(); setMessage(result === 'accepted' ? '已请求安装，请按浏览器提示完成。' : result === 'dismissed' ? '已取消安装，随时可以再试。' : '请从浏览器菜单添加到主屏幕。') }}><Download size={16} />安装 Countwell</button> : <details className="install-guide"><summary>如何添加到主屏幕 <ArrowUpRight size={14} /></summary><p>{pwa.ios ? 'iPhone / iPad：在浏览器分享菜单中选择「添加到主屏幕」，然后确认添加。' : 'Android：打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。电脑端可使用 Chrome / Edge 地址栏中的安装按钮。'}</p><p>首次联网打开后，演示账本可离线查看；真实账本只在页面内存中展示，刷新加载需要连接后端服务。</p></details>}{pwa.registrationError && <p className="account-note">离线组件尚未就绪，请联网刷新重试。</p>}{pwa.updateAvailable && <button className="button" onClick={() => pwa.applyUpdate()}>更新到最新版本</button>}</section>
    <section className="panel settings-section ledger-settings"><div className="section-heading"><div><h2>账本原文与文件</h2><p>原文保留，多个 include 文件按目录组织。</p></div><BookOpen size={21} className="settings-heading-icon" /></div><div className="ledger-file"><span className="file-icon"><BookOpen size={22} strokeWidth={1.5} /></span><div><strong>{ledger.title}</strong><p>{controller.real ? '官方 Beancount 校验通过' : '虚构演示账本'} · {files.length} 个文件 · {ledger.transactions.length} 笔交易</p></div><span className="small-badge">只读</span></div><div className="setting-actions"><button className="button" onClick={onSource}>查看原文<ArrowUpRight size={14} /></button><button className="button" disabled={hidden} onClick={download}><Download size={15} />{files.length > 1 ? '导出已加载文件' : '导出账本'}</button></div><p className="account-note">{controller.real ? '真实账本由官方 Beancount 处理 include、金额补全、插件和批次匹配。导出不包含附件和插件程序；原始账本始终保留在数据源中。' : '演示模式使用内置虚构数据；连接真实数据源后，将使用官方 Beancount 完整加载。'}</p></section>
    <section className="panel settings-section"><div className="privacy-note"><ShieldCheck size={17} /><span>真实账本与凭证不会进入前端构建或 PWA 缓存。凭证保存在本机私有配置中，浏览器仅保留界面偏好与数据源模式。</span></div></section>
    <div className="settings-message" role="status">{message}</div>
  </div>
}
