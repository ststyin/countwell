import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Github, LoaderCircle, RefreshCw } from 'lucide-react'
import BrandIcon from './BrandIcon'

interface AuthStatus {
  cloud: true
  configured: boolean
  authenticated: boolean
  user?: { login: string }
}

type GateState = { phase: 'checking' } | { phase: 'authenticated' } | { phase: 'signed-out'; configured: boolean } | { phase: 'error' }

const callbackMessages: Record<string, string> = {
  denied: '登录未获授权，请使用你的 GitHub 账号重试。',
  failed: '登录未完成，请重试。',
  unavailable: '登录尚未配置。',
}

function callbackMessage() {
  if (typeof window === 'undefined') return ''
  const code = new URL(window.location.href).searchParams.get('auth_error')
  return code ? callbackMessages[code] ?? '' : ''
}

export default function CloudGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: 'checking' })
  const [message] = useState(callbackMessage)
  const sequence = useRef(0)
  const controller = useRef<AbortController | null>(null)

  const check = useCallback(async () => {
    const current = ++sequence.current
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    const timeout = window.setTimeout(() => request.abort(), 15_000)
    setState({ phase: 'checking' })
    try {
      const response = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin', signal: request.signal })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Auth status unavailable')
      const status = await response.json() as AuthStatus
      if (status.cloud !== true || typeof status.configured !== 'boolean' || typeof status.authenticated !== 'boolean') throw new Error('Invalid auth status')
      if (current !== sequence.current) return
      setState(status.configured && status.authenticated ? { phase: 'authenticated' } : { phase: 'signed-out', configured: status.configured })
    } catch {
      if (current === sequence.current) setState({ phase: 'error' })
    } finally { window.clearTimeout(timeout) }
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('auth_error')) {
      url.searchParams.delete('auth_error')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
    void check()
    const expired = () => void check()
    window.addEventListener('countwell:session-expired', expired)
    return () => {
      sequence.current++
      controller.current?.abort()
      window.removeEventListener('countwell:session-expired', expired)
    }
  }, [check])

  useEffect(() => {
    if (state.phase !== 'authenticated') document.title = '登录账本 · Countwell'
  }, [state.phase])

  if (state.phase === 'authenticated') return children

  const unavailable = state.phase === 'signed-out' && !state.configured
  return <main className="cloud-gate">
    <section className="cloud-login-panel" aria-labelledby="cloud-login-title">
      <div className="cloud-brand"><span className="brand-mark"><BrandIcon /></span><span className="sr-only">Countwell</span></div>
      <h1 id="cloud-login-title">登录账本</h1>
      {state.phase === 'checking' ? <div className="cloud-login-status" role="status"><LoaderCircle size={18} className="spin" />正在连接…</div>
        : state.phase === 'error' ? <><p className="cloud-login-error" role="alert">暂时无法连接，请重试。</p><button className="button" onClick={() => void check()}><RefreshCw size={16} />重新连接</button></>
          : <>{(message || unavailable) && <p className="cloud-login-error" role="status">{unavailable ? '登录尚未配置。' : message}</p>}{unavailable ? <button className="button button-primary" disabled><Github size={17} />GitHub 登录</button> : <a className="button button-primary" href="/api/auth/github"><Github size={17} />GitHub 登录</a>}</>}
    </section>
  </main>
}
