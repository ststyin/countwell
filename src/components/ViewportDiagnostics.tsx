import { useEffect, useRef, useState } from 'react'

// Temporary, opt-in diagnostics: only viewport geometry, kept in memory.
const enabledKey = 'countwell.viewportDiagnostics'
const enabledInitially = () => { try { return localStorage.getItem(enabledKey) === 'true' } catch { return false } }

export default function ViewportDiagnostics({ loading, ready, settings, reload }: { loading: boolean; ready: boolean; settings: boolean; reload: () => void }) {
  const [enabled, setEnabled] = useState(enabledInitially)
  const [samples, setSamples] = useState<string[]>([])
  const previous = useRef('')
  const phase = loading ? '读取中' : ready ? '已加载' : '未加载'

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const start = performance.now()
    const capture = () => {
      const nav = document.querySelector<HTMLElement>('.mobile-nav')
      const viewport = window.visualViewport
      if (nav && getComputedStyle(nav).display !== 'none') {
        const bounds = nav.getBoundingClientRect()
        const rounded = (value: number | undefined) => value === undefined ? '不可用' : String(Math.round(value))
        const sample = `${phase} innerHeight=${rounded(window.innerHeight)} clientHeight=${rounded(document.documentElement.clientHeight)} visualHeight=${rounded(viewport?.height)} visualTop=${rounded(viewport?.offsetTop)} navBottom=${rounded(bounds.bottom)} cssBottom=${getComputedStyle(nav).bottom} scrollY=${rounded(window.scrollY)} documentHeight=${rounded(document.documentElement.scrollHeight)}`
        if (sample !== previous.current) {
          previous.current = sample
          setSamples(current => [...current, sample].slice(-20))
        }
      }
      if (performance.now() - start < 5000) frame = requestAnimationFrame(capture)
    }
    frame = requestAnimationFrame(capture)
    return () => cancelAnimationFrame(frame)
  }, [enabled, phase])

  const toggle = () => {
    const next = !enabled
    try { if (next) localStorage.setItem(enabledKey, 'true'); else localStorage.removeItem(enabledKey) } catch { /* Session-only when storage is unavailable. */ }
    setSamples([]); previous.current = ''; setEnabled(next)
  }
  return <>
    {settings && <div className="viewport-diagnostics-setting"><button className="button" onClick={toggle}>{enabled ? '关闭导航诊断' : '启用导航诊断'}</button></div>}
    {enabled && <aside className="viewport-diagnostics" aria-label="导航栏尺寸诊断">
      <strong>导航栏尺寸诊断</strong><p>仅显示屏幕尺寸，不读取或上传账本数据。</p>
      <pre>{samples.length ? samples.join('\n') : '等待手机导航栏…'}</pre>
      <div><button className="button" onClick={reload}>重新加载并记录</button><button className="button" onClick={() => void navigator.clipboard?.writeText(samples.join('\n'))}>复制</button><button className="button" onClick={toggle}>关闭</button></div>
    </aside>}
  </>
}
