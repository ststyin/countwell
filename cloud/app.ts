import type { SourceSnapshot } from '../src/lib/source-client'
import { authConfig, csrfToken, expiredCookie, finishGitHubLogin, oauthFailure, OAUTH_COOKIE, privateHeaders, SESSION_COOKIE, sessionFromRequest, startGitHubLogin, validCsrf } from './auth'
import type { CloudAuthEnv } from './auth'
import { expenseStatus, RecordingError, startExpense } from './record-expense'

export interface CloudEnv extends CloudAuthEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  COUNTWELL_GITHUB_ACTIONS_TOKEN?: string
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: privateHeaders({ 'Content-Type': 'application/json; charset=utf-8' }) })
}

function failure(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status)
}

/** The snapshot is only read after identity and request checks have passed. */
export function createCloudApp(getSnapshot: () => SourceSnapshot, fetcher: typeof fetch = fetch) {
  return { async fetch(request: Request, env: CloudEnv): Promise<Response> {
    const url = new URL(request.url)
    if (url.protocol !== 'https:') {
      url.protocol = 'https:'
      return new Response(null, { status: 308, headers: privateHeaders({ Location: url.toString() }) })
    }
    try {
      const path = url.pathname
      if (!path.startsWith('/api/') && path !== '/api') {
        if (/^\/(?:\.countwell|cloud|server)(?:\/|$)/i.test(path) || /\.(?:snapshot\.(?:txt|json)|beancount|bean)$/i.test(path)) return new Response(null, { status: 404, headers: privateHeaders() })
        return await env.ASSETS.fetch(request)
      }
      const config = authConfig(env)
      if (path === '/api/auth/status' && request.method === 'GET') {
        const session = config ? await sessionFromRequest(request, config) : null
        return json({ cloud: true, configured: Boolean(config), authenticated: Boolean(session), ...(session ? { user: { login: session.login } } : {}) })
      }
      if (path === '/api/auth/github' && request.method === 'GET') {
        return config ? await startGitHubLogin(request, config) : oauthFailure(request, 'unavailable')
      }
      if (path === '/api/auth/github/callback' && request.method === 'GET') {
        return config ? await finishGitHubLogin(request, config, fetcher) : oauthFailure(request, 'unavailable')
      }
      const session = config ? await sessionFromRequest(request, config) : null
      if (!session || !config) return failure('UNAUTHENTICATED', '请先登录。', 401)
      if (path === '/api/session' && request.method === 'GET') return json({ csrf: await csrfToken(session, config), apiVersion: 1, cloud: true })
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      if (mutating && request.headers.get('Origin') !== url.origin) return failure('FORBIDDEN', '请求来源不匹配。', 403)
      if (!await validCsrf(request, session, config)) return failure('FORBIDDEN', '会话校验失败，请刷新页面。', 403)
      if (path === '/api/auth/logout' && request.method === 'POST') {
        const response = json({ success: true })
        response.headers.append('Set-Cookie', expiredCookie(SESSION_COOKIE))
        response.headers.append('Set-Cookie', expiredCookie(OAUTH_COOKIE))
        return response
      }
      if (path === '/api/expenses' && request.method === 'POST') return json(await startExpense(request, getSnapshot(), session.uid, env.COUNTWELL_GITHUB_ACTIONS_TOKEN, fetcher), 202)
      if (path === '/api/expenses/status' && request.method === 'GET') return json(await expenseStatus(url.searchParams.get('id') ?? '', getSnapshot(), session.uid, env.COUNTWELL_GITHUB_ACTIONS_TOKEN, fetcher))
      if (path === '/api/ledger/status' && request.method === 'GET') return json(getSnapshot().status)
      if (path === '/api/ledger/snapshot' && request.method === 'GET') return json(getSnapshot())
      if (path === '/api/ledger/reload' && request.method === 'POST') return json(getSnapshot())
      if (['/api/ledger/source', '/api/ledger/connect'].includes(path)) return failure('CLOUD_READ_ONLY', '云端账本仅支持查看。', 405)
      return failure('NOT_FOUND', '接口不存在。', 404)
    } catch (error) {
      if (error instanceof RecordingError) return failure('RECORDING_ERROR', error.message, error.status)
      return failure('CLOUD_UNAVAILABLE', '账本服务暂时不可用。', 503)
    }
  } }
}
