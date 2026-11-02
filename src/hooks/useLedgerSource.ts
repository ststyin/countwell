import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDemoLedger } from '../domain'
import type { Ledger } from '../domain/types'
import type { ConnectRequest, SourceFailure, SourceStatus } from '../domain/source-types'
import { connectSource, disconnectSource, reloadSource, SourceClientError, sourceRequest } from '../lib/source-client'
import type { SourceSnapshot } from '../lib/source-client'
import { cloudMode } from '../lib/runtime'

function expectedReal() { try { return localStorage.getItem('countwell.realSource') === 'true' } catch { return false } }
function remember(real: boolean) { try { localStorage.setItem('countwell.realSource', String(real)) } catch { /* Only a mode preference, never a private ledger. */ } }
function emptyCloudLedger(): Ledger {
  return { title: 'Countwell', source: '', defaultMonth: new Date().toISOString().slice(0, 7), accounts: [], accountNames: [], commodities: [], prices: [], transactions: [] }
}

export function useLedgerSource() {
  const [ledger, setLedger] = useState<Ledger>(() => cloudMode ? emptyCloudLedger() : loadDemoLedger())
  const [status, setStatus] = useState<SourceStatus | null>(null)
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SourceFailure | null>(null)
  const [real, setReal] = useState(false)
  const [needsConnection, setNeedsConnection] = useState(() => cloudMode || expectedReal())
  const snapshotId = useRef<string | null>(null)
  const mounted = useRef(true)
  const operation = useRef(0)
  const operating = useRef(false)

  const expireSession = useCallback((error: unknown) => {
    if (!cloudMode || !(error instanceof SourceClientError) || error.failure.code !== 'UNAUTHENTICATED') return false
    operation.current++; snapshotId.current = null
    setLedger(emptyCloudLedger()); setStatus(null); setReal(false); setNeedsConnection(true); setError(null)
    window.dispatchEvent(new Event('countwell:session-expired'))
    return true
  }, [])

  const apply = useCallback((snapshot: SourceSnapshot) => {
    setLedger(snapshot.ledger); setStatus(snapshot.status); snapshotId.current = snapshot.status.snapshotId
    setReal(true); setNeedsConnection(false); setError(snapshot.status.lastError); remember(true)
  }, [])

  const refreshStatus = useCallback(async () => {
    if (operating.current) return
    const generation = operation.current
    try {
      const next = await sourceRequest<SourceStatus>('/api/ledger/status')
      if (!mounted.current || generation !== operation.current) return
      setBackendAvailable(true); setStatus(next)
      setError(next.lastError)
      if (!cloudMode && !next.configured && !next.connected && snapshotId.current) {
        snapshotId.current = null; setLedger(loadDemoLedger()); setReal(false); setNeedsConnection(false); setError(null); remember(false)
      }
      if (next.connected && next.snapshotId !== snapshotId.current) {
        const snapshot = await sourceRequest<SourceSnapshot>('/api/ledger/snapshot')
        if (mounted.current && generation === operation.current) apply(snapshot)
      }
      if ((cloudMode || next.configured) && !next.connected && !snapshotId.current) setNeedsConnection(true)
    } catch (error) {
      if (!mounted.current || generation !== operation.current) return
      if (expireSession(error)) return
      setBackendAvailable(false)
      if (cloudMode || expectedReal()) {
        setError(error instanceof SourceClientError ? error.failure : { message: cloudMode ? '无法连接账本，请稍后重试。' : '无法连接账本服务，请检查服务是否启动。' })
        if (!snapshotId.current) setNeedsConnection(true)
      }
    }
  }, [apply, expireSession])

  useEffect(() => {
    mounted.current = true; void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 5000)
    return () => { mounted.current = false; window.clearInterval(timer) }
  }, [refreshStatus])

  const load = async (request?: ConnectRequest) => {
    if (cloudMode && request) { setError({ message: '当前账本为云端只读模式。', code: 'CLOUD_READ_ONLY' }); return null }
    operation.current++; operating.current = true
    setBusy(true); setError(null)
    try {
      const snapshot = request ? await connectSource(request) : await reloadSource()
      apply(snapshot); setBackendAvailable(true); return snapshot
    } catch (error) {
      if (expireSession(error)) return null
      if (error instanceof SourceClientError) { setError(error.failure); if (error.sourceStatus) setStatus(error.sourceStatus) }
      else setError({ message: cloudMode ? '连接失败，请检查网络后重试。' : '连接失败，请检查本机账本服务或网络。' })
      return null
    } finally { operation.current++; operating.current = false; setBusy(false) }
  }

  const useDemo = async () => {
    if (cloudMode) { setError({ message: '当前账本为云端只读模式。', code: 'CLOUD_READ_ONLY' }); return }
    operation.current++; operating.current = true; setBusy(true)
    try {
    if (backendAvailable) {
      try { setStatus(await disconnectSource()) } catch (error) { setError({ message: error instanceof Error ? error.message : '暂时无法切换，请重试。' }); return }
    }
    snapshotId.current = null; setLedger(loadDemoLedger()); setReal(false); setNeedsConnection(false); setError(null); remember(false)
    } finally { operation.current++; operating.current = false; setBusy(false) }
  }
  return { ledger, status, backendAvailable, busy: busy || status?.loading === true, error, real, needsConnection, connect: (request: ConnectRequest) => load(request), reload: () => load(), useDemo, refreshStatus }
}

export type LedgerSourceController = ReturnType<typeof useLedgerSource>
