import { useState } from 'react'
import { ArrowUpRight, BookOpen, Check, Download, Laptop, Moon, Smartphone, Sun, WifiOff } from 'lucide-react'
import { usePwa } from '../hooks/usePwa'
import type { Ledger } from '../domain/types'
import { zipSync, strToU8 } from 'fflate'
import SourceSettings from '../components/SourceSettings'
import type { LedgerSourceController } from '../hooks/useLedgerSource'
import { cloudMode } from '../lib/runtime'

export default function SettingsPage({ ledger, theme, onTheme, hidden, onPrivacy, onSource, controller }: { ledger: Ledger; theme: string; onTheme: (theme: string) => void; hidden: boolean; onPrivacy: (hidden: boolean) => void; onSource: () => void; controller: LedgerSourceController }) {
  const pwa = usePwa()
  const [message, setMessage] = useState('')
  const files = ledger.files?.length ? ledger.files : cloudMode ? [] : [{ path: 'demo.beancount', content: ledger.source }]
  const download = () => {
    if (!files.length) return
    const multiple = files.length > 1
    const data = multiple ? zipSync(Object.fromEntries(files.map(file => [file.path, strToU8(file.content)])), { level: 1 }) : null
    const blob = data ? new Blob([new Uint8Array(data).buffer], { type: 'application/zip' }) : new Blob([files[0].content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = multiple ? 'countwell-ledger-files.zip' : files[0].path.split('/').at(-1) ?? 'main.beancount'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(multiple ? '已导出账本文件，不含附件、凭证或插件。' : '已导出账本。')
  }
  return <div className="settings-layout">
    <SourceSettings controller={controller} />
    <section className="panel settings-section"><div className="section-heading"><h2>外观</h2><Laptop size={20} className="settings-heading-icon" /></div><div className="setting-row"><strong>主题</strong><div className="segmented"><button aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}><Moon size={15} />深色</button><button aria-pressed={theme === 'light'} onClick={() => onTheme('light')}><Sun size={15} />浅色</button></div></div><div className="setting-row"><strong>隐藏金额</strong><button className={`toggle ${hidden ? 'on' : ''}`} role="switch" aria-checked={hidden} aria-label="隐藏金额" onClick={() => onPrivacy(!hidden)}><span /></button></div></section>
    <section className="panel settings-section pwa-settings"><div className="section-heading"><h2>安装应用</h2><Smartphone size={21} className="settings-heading-icon" /></div><div className="pwa-feature-row"><span>{cloudMode ? <Check size={15} /> : <WifiOff size={15} />}{cloudMode ? pwa.offlineReady ? '应用已就绪' : '应用准备中' : pwa.offlineReady ? '离线演示已就绪' : '离线演示准备中'}</span></div>{pwa.isStandalone || pwa.installed ? <div className="install-state"><Check size={17} />已安装</div> : pwa.installAvailable ? <button className="button button-primary" onClick={async () => { const result = await pwa.install(); setMessage(result === 'accepted' ? '请按浏览器提示完成安装。' : result === 'dismissed' ? '已取消安装。' : '请从浏览器菜单添加到主屏幕。') }}><Download size={16} />安装 Countwell</button> : <details className="disclosure install-guide"><summary>添加到主屏幕 <ArrowUpRight size={14} /></summary><div className="disclosure-content"><p>{pwa.ios ? '在浏览器分享菜单中选择「添加到主屏幕」。' : '手机：在浏览器菜单中选择「安装应用」或「添加到主屏幕」。电脑：使用地址栏中的安装按钮。'}</p><p>{cloudMode ? '登录和加载账本需要联网。' : '演示账本可离线查看；真实账本刷新时需要连接账本服务。'}</p></div></details>}{pwa.registrationError && <p className="account-note">离线组件未就绪，请联网刷新。</p>}{pwa.updateAvailable && <button className="button" onClick={() => pwa.applyUpdate()}>更新应用</button>}</section>
    <section className="panel settings-section ledger-settings"><div className="section-heading"><h2>账本文件</h2><BookOpen size={21} className="settings-heading-icon" /></div><div className="ledger-file"><span className="file-icon"><BookOpen size={22} strokeWidth={1.5} /></span><div><strong>{ledger.title}</strong><p>{controller.real ? '真实账本' : cloudMode ? '尚未加载' : '虚构演示账本'} · {files.length} 个文件 · {ledger.transactions.length} 笔交易</p></div><span className="small-badge">只读</span></div><div className="setting-actions"><button className="button" disabled={!files.length} onClick={onSource}>查看原文<ArrowUpRight size={14} /></button><button className="button" disabled={hidden || !files.length} onClick={download}><Download size={15} />导出账本</button></div></section>
    <div className="settings-message" role="status">{message}</div>
  </div>
}
