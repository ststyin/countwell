import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudApp } from '../cloud/app'
import type { CloudEnv } from '../cloud/app'
import { OAUTH_COOKIE, SESSION_COOKIE } from '../cloud/auth'
import type { SourceSnapshot } from '../src/lib/source-client'
import { clearSourceSession } from '../src/lib/source-client'
import { connectCloud } from '../src/lib/cloud-connection'

const origin = 'https://ledger.example'
const snapshot: SourceSnapshot = {
  ledger: {
    title: 'Synthetic confidential fixture', source: 'SYNTHETIC_PRIVATE_SOURCE', defaultMonth: '2026-10',
    accounts: [], accountNames: [], transactions: [], prices: [], commodities: [],
    files: [{ path: 'books/main.beancount', content: 'SYNTHETIC_PRIVATE_SOURCE' }],
  },
  status: {
    configured: true, loading: false, connected: true,
    source: { type: 'github', repository: 'fixture/private-ledger', ref: 'main', entryPath: 'books/main.beancount' },
    allowPlugins: false, loadedAt: '2026-10-31T00:00:00Z', snapshotId: 'fixture-snapshot', revision: 'fixture-revision',
    fileCount: 1, transactionCount: 0, engineVersion: '3.2.3', lastError: null,
  },
}

function request(path: string, init: RequestInit = {}) {
  return new Request(origin + path, init)
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function setup(options: { user?: unknown; tokenResponse?: () => Response; throwNetwork?: boolean } = {}) {
  const getSnapshot = vi.fn(() => snapshot)
  const assets = vi.fn(async () => new Response('Public application shell', { headers: { 'Content-Type': 'text/html' } }))
  const env: CloudEnv = {
    ASSETS: { fetch: assets }, GITHUB_CLIENT_ID: 'fixture-client', GITHUB_CLIENT_SECRET: 'fixture-client-secret',
    SESSION_SECRET: 'fixture-session-secret-never-for-production-123456', GITHUB_ALLOWED_USER_ID: '42',
  }
  const github = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    if (options.throwNetwork) throw new Error('SYNTHETIC_PROVIDER_SECRET')
    const url = String(input)
    if (url === 'https://github.com/login/oauth/access_token') return options.tokenResponse?.() ?? jsonResponse({ access_token: 'fixture-oauth-token', token_type: 'bearer', scope: 'read:user' })
    if (url === 'https://api.github.com/user') return jsonResponse(options.user ?? { id: 42, login: 'fixture-owner' })
    throw new Error('Unexpected upstream destination')
  })
  const app = createCloudApp(getSnapshot, github as typeof fetch)
  return { app, env, github, getSnapshot, assets }
}

type Context = ReturnType<typeof setup>

function cookies(response: Response) { return response.headers.getSetCookie() }
function cookie(response: Response, name: string) {
  const value = cookies(response).find(value => value.startsWith(name + '='))
  if (!value) throw new Error(`Missing fixture cookie: ${name}`)
  return value.split(';')[0]
}

async function begin(context: Context) {
  const response = await context.app.fetch(request('/api/auth/github'), context.env)
  const location = new URL(response.headers.get('location')!)
  return { response, location, oauthCookie: cookie(response, OAUTH_COOKIE), state: location.searchParams.get('state')! }
}

async function signIn(context: Context) {
  const started = await begin(context)
  const response = await context.app.fetch(request(`/api/auth/github/callback?code=fixture-code&state=${started.state}`, {
    headers: { Cookie: started.oauthCookie },
  }), context.env)
  return { ...started, response, sessionCookie: cookie(response, SESSION_COOKIE) }
}

async function session(context: Context, sessionCookie: string) {
  const response = await context.app.fetch(request('/api/session', { headers: { Cookie: sessionCookie } }), context.env)
  return { response, csrf: (await response.json() as { csrf: string }).csrf }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearSourceSession() })

describe('private cloud login and snapshot interface', () => {
  it('connects the parallel client to the real authenticated cloud API without exposing anonymous snapshots', async () => {
    const context = setup()
    const { sessionCookie } = await signIn(context)
    let cookieValue = sessionCookie
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      if (cookieValue) headers.set('Cookie', cookieValue)
      return context.app.fetch(request(path, { ...init, headers }), context.env)
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await connectCloud(new AbortController())).toEqual({ phase: 'authenticated', snapshot })
    expect(context.getSnapshot).toHaveBeenCalledTimes(1)
    context.getSnapshot.mockClear()
    cookieValue = ''
    const anonymous = await connectCloud(new AbortController())
    expect(anonymous).toEqual({ phase: 'signed-out', configured: true })
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('fails closed for each missing setting and a weak signing secret without reading a ledger', async () => {
    for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'GITHUB_ALLOWED_USER_ID'] as const) {
      const context = setup()
      delete context.env[name]
      const response = await context.app.fetch(request('/api/auth/status'), context.env)
      expect(await response.json()).toEqual({ cloud: true, configured: false, authenticated: false })
      expect(context.getSnapshot).not.toHaveBeenCalled()
      const start = await context.app.fetch(request('/api/auth/github'), context.env)
      expect(start.headers.get('location')).toBe(origin + '/?auth_error=unavailable')
      expect(context.github).not.toHaveBeenCalled()
    }
    const context = setup()
    context.env.SESSION_SECRET = 'short'
    expect(await (await context.app.fetch(request('/api/auth/status'), context.env)).json()).toEqual({ cloud: true, configured: false, authenticated: false })
    context.env.SESSION_SECRET = 'fixture-long-enough-session-secret-12345'
    context.env.GITHUB_ALLOWED_USER_ID = '*'
    expect(await (await context.app.fetch(request('/api/auth/status'), context.env)).json()).toMatchObject({ configured: false })
  })

  it('rejects anonymous ledger requests and unknown APIs without revealing source metadata', async () => {
    const context = setup()
    const paths = ['/api/session', '/api/ledger/status', '/api/ledger/snapshot', '/api/ledger/reload', '/api/ledger/connect', '/api/ledger/source', '/api/unknown', '/api']
    for (const path of paths) {
      const response = await context.app.fetch(request(path), context.env)
      expect(response.status).toBe(401)
      const body = await response.text()
      expect(JSON.parse(body)).toEqual({ error: { code: 'UNAUTHENTICATED', message: '请先登录。' } })
      expect(body).not.toContain('fixture/private-ledger')
      expect(body).not.toContain('SYNTHETIC_PRIVATE_SOURCE')
      expect(response.headers.get('cache-control')).toBe('no-store, private')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
    }
    expect(context.getSnapshot).not.toHaveBeenCalled()
    expect(context.assets).not.toHaveBeenCalled()
  })

  it('serves the public shell separately and refuses guessed source-file paths', async () => {
    const context = setup()
    expect(await (await context.app.fetch(request('/'), context.env)).text()).toBe('Public application shell')
    expect(context.assets).toHaveBeenCalledTimes(1)
    for (const path of ['/.countwell/cloud/ledger.snapshot.txt', '/cloud/worker.ts', '/server/beancount/load.py', '/ledger.snapshot.json', '/main.beancount']) {
      expect((await context.app.fetch(request(path), context.env)).status).toBe(404)
    }
    expect(context.assets).toHaveBeenCalledTimes(1)
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('redirects HTTP to HTTPS before reading cookies or data', async () => {
    const context = setup()
    const response = await context.app.fetch(new Request('http://ledger.example/api/ledger/snapshot'), context.env)
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(origin + '/api/ledger/snapshot')
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('starts OAuth with a fresh PKCE challenge, signed browser state and no repository scope', async () => {
    const context = setup()
    const first = await begin(context)
    const second = await begin(context)
    expect(first.location.origin + first.location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(first.location.searchParams.get('redirect_uri')).toBe(origin + '/api/auth/github/callback')
    expect(first.location.searchParams.get('scope')).toBe('read:user')
    expect(first.location.searchParams.get('scope')).not.toContain('repo')
    expect(first.location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(first.location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.state).not.toBe(second.state)
    expect(first.location.searchParams.get('code_challenge')).not.toBe(second.location.searchParams.get('code_challenge'))
    expect(cookies(first.response)[0]).toContain('HttpOnly; Secure; SameSite=Lax; Max-Age=600')
    expect(first.location.href).not.toContain(context.env.GITHUB_CLIENT_SECRET)
    expect(first.response.headers.get('cache-control')).toBe('no-store, private')
    expect(context.github).not.toHaveBeenCalled()
  })

  it('exchanges the code at GitHub, validates identity and issues a fresh strict session without retaining provider tokens', async () => {
    const context = setup()
    const loggedIn = await signIn(context)
    expect(loggedIn.response.status).toBe(302)
    expect(loggedIn.response.headers.get('location')).toBe(origin + '/')
    expect(cookies(loggedIn.response).some(value => value.startsWith(OAUTH_COOKIE + '=;') && value.includes('Max-Age=0'))).toBe(true)
    expect(cookies(loggedIn.response).find(value => value.startsWith(SESSION_COOKIE + '='))).toContain('HttpOnly; Secure; SameSite=Strict; Max-Age=28800')
    const tokenRequest = context.github.mock.calls[0]
    expect(tokenRequest[0]).toBe('https://github.com/login/oauth/access_token')
    expect(tokenRequest[1]?.method).toBe('POST')
    expect(tokenRequest[1]?.redirect).toBe('manual')
    const params = new URLSearchParams(tokenRequest[1]?.body as URLSearchParams)
    expect(params.get('client_secret')).toBe(context.env.GITHUB_CLIENT_SECRET)
    expect(params.get('redirect_uri')).toBe(origin + '/api/auth/github/callback')
    const verifier = params.get('code_verifier')!
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    expect(challenge).toBe(loggedIn.location.searchParams.get('code_challenge'))
    expect(context.github.mock.calls[1][0]).toBe('https://api.github.com/user')
    expect(new Headers(context.github.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer fixture-oauth-token')
    expect(context.github.mock.calls[1][1]?.redirect).toBe('manual')
    expect(loggedIn.sessionCookie).not.toContain('fixture-oauth-token')
    expect(loggedIn.sessionCookie).not.toContain(context.env.GITHUB_CLIENT_SECRET)
    const status = await context.app.fetch(request('/api/auth/status', { headers: { Cookie: loggedIn.sessionCookie } }), context.env)
    expect(await status.json()).toEqual({ cloud: true, configured: true, authenticated: true, user: { login: 'fixture-owner' } })
    expect(context.getSnapshot).not.toHaveBeenCalled()
    const second = await signIn(context)
    expect(second.sessionCookie).not.toBe(loggedIn.sessionCookie)
  })

  it('rejects missing, mismatched and tampered OAuth state before contacting GitHub', async () => {
    for (const variant of ['missing', 'mismatch', 'tampered', 'wrong-origin'] as const) {
      const context = setup()
      const started = await begin(context)
      const stateCookie = variant === 'tampered' ? started.oauthCookie.replace('=', '=X') : started.oauthCookie
      const url = new URL(`/api/auth/github/callback?code=fixture-code&state=${variant === 'mismatch' ? 'wrong' : started.state}`, origin)
      if (variant === 'wrong-origin') url.host = 'other.example'
      const response = await context.app.fetch(new Request(url, { headers: variant === 'missing' ? {} : { Cookie: stateCookie } }), context.env)
      expect(response.headers.get('location')).toBe(url.origin + '/?auth_error=failed')
      expect(context.github).not.toHaveBeenCalled()
      expect(context.getSnapshot).not.toHaveBeenCalled()
    }
  })

  it('expires OAuth state after ten minutes and clears the consumed browser state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const context = setup()
    const started = await begin(context)
    vi.setSystemTime(new Date('2030-01-01T00:10:01Z'))
    const response = await context.app.fetch(request(`/api/auth/github/callback?code=fixture-code&state=${started.state}`, { headers: { Cookie: started.oauthCookie } }), context.env)
    expect(response.headers.get('location')).toBe(origin + '/?auth_error=failed')
    expect(cookies(response).some(value => value.startsWith(OAUTH_COOKIE + '=;') && value.includes('Max-Age=0'))).toBe(true)
    expect(context.github).not.toHaveBeenCalled()
  })

  it('handles an OAuth denial using a fixed error URL without echoing provider text', async () => {
    const context = setup()
    const started = await begin(context)
    const response = await context.app.fetch(request(`/api/auth/github/callback?state=${started.state}&error=access_denied&error_description=SYNTHETIC_PROVIDER_SECRET`, { headers: { Cookie: started.oauthCookie } }), context.env)
    expect(response.headers.get('location')).toBe(origin + '/?auth_error=denied')
    expect(await response.text()).not.toContain('SYNTHETIC_PROVIDER_SECRET')
    expect(context.github).not.toHaveBeenCalled()
  })

  it.each([
    { user: { id: 99, login: 'fixture-owner' } },
    { user: { id: '42', login: 'fixture-owner' } },
    { user: { id: 42, login: '<script>' } },
  ])('rejects non-owner or invalid identity even when a login name matches', async options => {
    const context = setup(options)
    const started = await begin(context)
    const response = await context.app.fetch(request(`/api/auth/github/callback?code=fixture-code&state=${started.state}`, { headers: { Cookie: started.oauthCookie } }), context.env)
    expect(response.headers.get('location')).toBe(origin + '/?auth_error=denied')
    expect(cookies(response).find(value => value.startsWith(SESSION_COOKIE + '='))).toContain('Max-Age=0')
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it.each([
    () => new Response('Provider error: SYNTHETIC_PROVIDER_SECRET', { status: 502 }),
    () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } }),
    () => jsonResponse({ error: 'bad_verification_code', error_description: 'SYNTHETIC_PROVIDER_SECRET' }),
    () => jsonResponse({ access_token: 'fixture-oauth-token', token_type: 'unexpected' }),
  ])('contains token exchange failures and redirects without forwarding credentials', async tokenResponse => {
    const context = setup({ tokenResponse })
    const started = await begin(context)
    const response = await context.app.fetch(request(`/api/auth/github/callback?code=fixture-code&state=${started.state}`, { headers: { Cookie: started.oauthCookie } }), context.env)
    expect(response.headers.get('location')).toBe(origin + '/?auth_error=failed')
    expect(await response.text()).not.toContain('SYNTHETIC_PROVIDER_SECRET')
    expect(context.github).toHaveBeenCalledTimes(1)
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('contains network errors without exposing tokens or provider diagnostics', async () => {
    const context = setup({ throwNetwork: true })
    const started = await begin(context)
    const response = await context.app.fetch(request(`/api/auth/github/callback?code=fixture-code&state=${started.state}`, { headers: { Cookie: started.oauthCookie } }), context.env)
    expect(response.headers.get('location')).toBe(origin + '/?auth_error=failed')
    expect(await response.text()).not.toContain('SYNTHETIC_PROVIDER_SECRET')
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('provides the canonical snapshot only to an authenticated session with its own CSRF token', async () => {
    const context = setup()
    const { sessionCookie } = await signIn(context)
    const initialized = await session(context, sessionCookie)
    expect(initialized.response.status).toBe(200)
    expect(initialized.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const denied = await context.app.fetch(request('/api/ledger/snapshot', { headers: { Cookie: sessionCookie } }), context.env)
    expect(denied.status).toBe(403)
    expect(context.getSnapshot).not.toHaveBeenCalled()
    for (const path of ['/api/ledger/status', '/api/ledger/snapshot']) {
      const response = await context.app.fetch(request(path, { headers: { Cookie: sessionCookie, 'X-Countwell-Token': initialized.csrf } }), context.env)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(path.endsWith('status') ? snapshot.status : snapshot)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
      expect(response.headers.get('vary')).toBe('Cookie')
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
    }
    const refreshed = await context.app.fetch(request('/api/ledger/reload', { method: 'POST', headers: { Cookie: sessionCookie, 'X-Countwell-Token': initialized.csrf, Origin: origin } }), context.env)
    expect(await refreshed.json()).toEqual(snapshot)
  })

  it('rejects cross-origin changes, missing CSRF and tokens from another session', async () => {
    const context = setup()
    const first = await signIn(context)
    const firstSession = await session(context, first.sessionCookie)
    const second = await signIn(context)
    const secondSession = await session(context, second.sessionCookie)
    const attempts: Record<string, string>[] = [
      { Cookie: first.sessionCookie, 'X-Countwell-Token': firstSession.csrf, Origin: 'https://attacker.example' },
      { Cookie: first.sessionCookie, 'X-Countwell-Token': firstSession.csrf },
      { Cookie: first.sessionCookie, Origin: origin },
      { Cookie: first.sessionCookie, 'X-Countwell-Token': secondSession.csrf, Origin: origin },
    ]
    for (const headers of attempts) {
      const response = await context.app.fetch(request('/api/ledger/reload', { method: 'POST', headers }), context.env)
      expect(response.status).toBe(403)
    }
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('expires sessions at eight hours and never substitutes public demo data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const context = setup()
    const loggedIn = await signIn(context)
    vi.setSystemTime(new Date('2030-01-01T08:00:01Z'))
    const response = await context.app.fetch(request('/api/session', { headers: { Cookie: loggedIn.sessionCookie } }), context.env)
    expect(response.status).toBe(401)
    expect(await (await context.app.fetch(request('/api/auth/status', { headers: { Cookie: loggedIn.sessionCookie } }), context.env)).json()).toEqual({ cloud: true, configured: true, authenticated: false })
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('rejects altered, duplicated, wrong-audience and previous-owner session cookies', async () => {
    const context = setup()
    const loggedIn = await signIn(context)
    const [payload, signature] = loggedIn.sessionCookie.split('=')[1].split('.')
    const changedSignature = (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1)
    for (const value of [`${SESSION_COOKIE}=${payload}.${changedSignature}`, `${loggedIn.sessionCookie}; ${loggedIn.sessionCookie}`]) {
      expect((await context.app.fetch(request('/api/session', { headers: { Cookie: value } }), context.env)).status).toBe(401)
    }
    expect((await context.app.fetch(new Request('https://other.example/api/session', { headers: { Cookie: loggedIn.sessionCookie } }), context.env)).status).toBe(401)
    context.env.GITHUB_ALLOWED_USER_ID = '99'
    expect((await context.app.fetch(request('/api/session', { headers: { Cookie: loggedIn.sessionCookie } }), context.env)).status).toBe(401)
    context.env.GITHUB_ALLOWED_USER_ID = '42'
    context.env.SESSION_SECRET = 'a-replaced-secret-long-enough-for-signing-12345'
    expect((await context.app.fetch(request('/api/session', { headers: { Cookie: loggedIn.sessionCookie } }), context.env)).status).toBe(401)
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('does not expose source editing or deletion in cloud mode', async () => {
    const context = setup()
    const loggedIn = await signIn(context)
    const initialized = await session(context, loggedIn.sessionCookie)
    for (const [path, method] of [['/api/ledger/connect', 'POST'], ['/api/ledger/source', 'DELETE']]) {
      const response = await context.app.fetch(request(path, { method, headers: { Cookie: loggedIn.sessionCookie, 'X-Countwell-Token': initialized.csrf, Origin: origin } }), context.env)
      expect(response.status).toBe(405)
      expect(await response.json()).toEqual({ error: { code: 'CLOUD_READ_ONLY', message: '云端账本仅支持查看。' } })
    }
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('clears both browser cookies on a valid logout and requires a new login afterwards', async () => {
    const context = setup()
    const loggedIn = await signIn(context)
    const initialized = await session(context, loggedIn.sessionCookie)
    const response = await context.app.fetch(request('/api/auth/logout', { method: 'POST', headers: { Cookie: loggedIn.sessionCookie, 'X-Countwell-Token': initialized.csrf, Origin: origin } }), context.env)
    expect(await response.json()).toEqual({ success: true })
    expect(cookies(response)).toHaveLength(2)
    expect(cookies(response).every(value => value.includes('Max-Age=0') && value.includes('HttpOnly; Secure;'))).toBe(true)
    expect((await context.app.fetch(request('/api/ledger/snapshot'), context.env)).status).toBe(401)
    expect(context.getSnapshot).not.toHaveBeenCalled()
  })

  it('keeps snapshot read errors private', async () => {
    const context = setup()
    context.getSnapshot.mockImplementation(() => { throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC') })
    const loggedIn = await signIn(context)
    const initialized = await session(context, loggedIn.sessionCookie)
    const response = await context.app.fetch(request('/api/ledger/snapshot', { headers: { Cookie: loggedIn.sessionCookie, 'X-Countwell-Token': initialized.csrf } }), context.env)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('SYNTHETIC_PRIVATE_DIAGNOSTIC')
  })
})

describe('recording endpoint protection', () => {
  it('rejects anonymous and cross-site writes before dispatching a workflow', async () => {
    const context = setup()
    context.env.COUNTWELL_GITHUB_ACTIONS_TOKEN = 'fixture-actions-token'
    const anonymous = await context.app.fetch(request('/api/expenses', { method: 'POST', body: '{}' }), context.env)
    expect(anonymous.status).toBe(401)
    const { sessionCookie } = await signIn(context)
    const { csrf } = await session(context, sessionCookie)
    context.github.mockClear()
    const crossSite = await context.app.fetch(request('/api/expenses', { method: 'POST', headers: { Cookie: sessionCookie, Origin: 'https://evil.example', 'X-Countwell-Token': csrf }, body: '{}' }), context.env)
    expect(crossSite.status).toBe(403)
    const noCsrf = await context.app.fetch(request('/api/expenses', { method: 'POST', headers: { Cookie: sessionCookie, Origin: origin }, body: '{}' }), context.env)
    expect(noCsrf.status).toBe(403)
    expect(context.github).not.toHaveBeenCalled()
  })
})
