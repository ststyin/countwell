import { useState } from 'react'
import { ArrowUpRight, BookOpen, Check, Download, Github, Laptop, Moon, ShieldCheck, Smartphone, Sun, WifiOff } from 'lucide-react'
import { usePwa } from '../hooks/usePwa'
import type { Ledger } from '../domain/types'

export default function SettingsPage({ ledger, theme, onTheme, hidden, onPrivacy, onSource }: { ledger: Ledger; theme: string; onTheme: (theme: string) => void; hidden: boolean; onPrivacy: (hidden: boolean) => void; onSource: () => void }) {
  const pwa = usePwa()
  const [message, setMessage] = useState('')
  const download = () => {
    const url = URL.createObjectURL(new Blob([ledger.source], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'countwell-demo.beancount'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('演示账本已导出，可用 Beancount 或 Fava 打开。')
  }
  return <div className="settings-layout">
    <section className="panel settings-section"><div className="section-heading"><div><h2>按你的习惯来</h2><p>舒服的界面，看钱也轻松一点。</p></div><Laptop size={20} className="settings-heading-icon" /></div><div className="setting-row"><div><strong>界面外观</strong><p>深色或浅色，由你决定。</p></div><div className="segmented"><button aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}><Moon size={15} />深色</button><button aria-pressed={theme === 'light'} onClick={() => onTheme('light')}><Sun size={15} />浅色</button></div></div><div className="setting-row"><div><strong>隐藏金额</strong><p>在公共场合也能安心查看。</p></div><button className={`toggle ${hidden ? 'on' : ''}`} role="switch" aria-checked={hidden} aria-label="隐藏金额" onClick={() => onPrivacy(!hidden)}><span /></button></div></section>
    <section className="panel settings-section pwa-settings"><div className="section-heading"><div><h2>把账本放进口袋</h2><p>添加到主屏幕，像 App 一样打开。</p></div><Smartphone size={21} className="settings-heading-icon" /></div><div className="pwa-feature-row"><span><Check size={15} />手机与电脑适配</span><span><WifiOff size={15} />{pwa.offlineReady ? '离线演示已就绪' : '首次联网后准备离线演示'}</span></div>{pwa.isStandalone || pwa.installed ? <div className="install-state"><Check size={17} />已作为应用打开或安装</div> : pwa.installAvailable ? <button className="button button-primary" onClick={async () => { const result = await pwa.install(); setMessage(result === 'accepted' ? '已请求安装，请按浏览器提示完成。' : result === 'dismissed' ? '已取消安装，随时可以再试。' : '请从浏览器菜单添加到主屏幕。') }}><Download size={16} />安装 Countwell</button> : <details className="install-guide"><summary>如何添加到主屏幕 <ArrowUpRight size={14} /></summary><p>{pwa.ios ? 'iPhone / iPad：在浏览器分享菜单中选择「添加到主屏幕」，然后确认添加。' : 'Android：打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。电脑端可使用 Chrome / Edge 地址栏中的安装按钮。'}</p><p>首次联网打开后，内置演示账本可离线查看；GitHub 实时同步需要联网。</p></details>}{pwa.registrationError && <p className="account-note">离线组件尚未就绪，请联网刷新重试。</p>}{pwa.updateAvailable && <button className="button" onClick={() => pwa.applyUpdate()}>更新到最新版本</button>}</section>
    <section className="panel settings-section ledger-settings"><div className="section-heading"><div><h2>你的账本，始终属于你</h2><p>一份纯文本文件，随时带走。</p></div><BookOpen size={21} className="settings-heading-icon" /></div><div className="ledger-file"><span className="file-icon"><BookOpen size={22} strokeWidth={1.5} /></span><div><strong>demo.beancount</strong><p>虚构演示账本 · {ledger.transactions.length} 笔交易</p></div><span className="small-badge">只读</span></div><div className="setting-actions"><button className="button" onClick={onSource}>查看原文<ArrowUpRight size={14} /></button><button className="button" disabled={hidden} onClick={download}><Download size={15} />导出账本</button></div><p className="account-note">账本原文与 Fava 兼容。当前 TypeScript 读取器只支持演示所需语法；完整 include、插件与批次匹配会接入官方引擎。</p></section>
    <section className="panel settings-section github-settings"><div className="section-heading"><div><h2>GitHub 数据源</h2><p>让你和 agent 编辑的账本，随提交更新。</p></div><Github size={21} className="settings-heading-icon" /></div><div className="connection-status"><span className="status-dot" /><strong>尚未连接</strong><span>当前使用内置虚构数据</span></div><p className="github-explanation">计划从私有仓库读取 Beancount 文件，校验后生成只读报表。账本文件保持为原始数据，报表可以随时重建。这个 demo 不会向 GitHub 发送或读取任何数据。</p><div className="privacy-note"><ShieldCheck size={17} /><span>当前没有登录、远程同步或网页记账。浏览器仅保存外观、币种和金额可见性等偏好。</span></div></section>
    <div className="settings-message" role="status">{message}</div>
  </div>
}
