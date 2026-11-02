export interface CloudAuthEnv {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  SESSION_SECRET?: string
  GITHUB_ALLOWED_USER_ID?: string
}

export interface AuthConfig {
  clientId: string
  clientSecret: string
  secret: string
  allowedUserId: string
}

interface SignedPayload {
  v: 1
  purpose: 'oauth' | 'session'
  aud: string
  iat: number
  exp: number
}

interface OAuthState extends SignedPayload {
  purpose: 'oauth'
  nonce: string
  verifier: string
}

export interface AuthSession extends SignedPayload {
  purpose: 'session'
  uid: string
  login: string
  sid: string
}

export const SESSION_COOKIE = '__Host-countwell-session'
export const OAUTH_COOKIE = '__Host-countwell-oauth'
const SESSION_SECONDS = 8 * 60 * 60
const OAUTH_SECONDS = 10 * 60
const encoder = new TextEncoder()

export function authConfig(env: CloudAuthEnv): AuthConfig | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim()
  const secret = env.SESSION_SECRET
  const allowedUserId = env.GITHUB_ALLOWED_USER_ID?.trim()
  if (!clientId || clientId.length > 200 || !clientSecret || clientSecret.length > 4096
      || !secret || encoder.encode(secret).length < 32 || secret.length > 4096
      || !allowedUserId || !/^[1-9]\d{0,19}$/.test(allowedUserId)) return null
  return { clientId, clientSecret, secret, allowedUserId }
}

export function privateHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial)
  headers.set('Cache-Control', 'no-store, private')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Vary', 'Cookie')
  return headers
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null
  try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)) }
  catch { return null }
}

function nonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function sign(value: string, secret: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(value))))
}

async function verify(value: string, signature: string, secret: string): Promise<boolean> {
  const decoded = decode64(signature)
  if (!decoded || decoded.byteLength !== 32) return false
  return crypto.subtle.verify('HMAC', await key(secret), decoded, encoder.encode(value))
}

async function signedCookie(payload: SignedPayload, secret: string): Promise<string> {
  const encoded = base64url(encoder.encode(JSON.stringify(payload)))
  return `${encoded}.${await sign(encoded, secret)}`
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? ''
  if (header.length > 16_384) return null
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
  return values.length === 1 ? values[0].slice(name.length + 1) : null
}

async function readSigned(request: Request, name: string, purpose: SignedPayload['purpose'], config: AuthConfig): Promise<Record<string, unknown> | null> {
  const token = cookieValue(request, name)
  if (!token || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !await verify(parts[0], parts[1], config.secret)) return null
  const encoded = decode64(parts[0])
  if (!encoded) return null
  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded)) as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    if (!payload || typeof payload !== 'object' || payload.v !== 1 || payload.purpose !== purpose
        || payload.aud !== new URL(request.url).origin
        || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
        || (payload.iat as number) > now + 30 || (payload.exp as number) <= now
        || (payload.exp as number) <= (payload.iat as number)
        || (payload.exp as number) - (payload.iat as number) > (purpose === 'session' ? SESSION_SECONDS : OAUTH_SECONDS)) return null
    return payload
  } catch { return null }
}

function setCookie(name: string, value: string, seconds: number, sameSite: 'Lax' | 'Strict') {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`
}

export function expiredCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=${name === OAUTH_COOKIE ? 'Lax' : 'Strict'}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

export async function sessionFromRequest(request: Request, config: AuthConfig): Promise<AuthSession | null> {
  const payload = await readSigned(request, SESSION_COOKIE, 'session', config)
  if (!payload || payload.uid !== config.allowedUserId || typeof payload.login !== 'string'
      || !/^[A-Za-z0-9-]{1,100}$/.test(payload.login)
      || typeof payload.sid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.sid)) return null
  return payload as unknown as AuthSession
}

function csrfValue(session: AuthSession): string {
  return `csrf:${session.aud}:${session.uid}:${session.sid}`
}

export function csrfToken(session: AuthSession, config: AuthConfig): Promise<string> {
  return sign(csrfValue(session), config.secret)
}

export function validCsrf(request: Request, session: AuthSession, config: AuthConfig): Promise<boolean> {
  return verify(csrfValue(session), request.headers.get('X-Countwell-Token') ?? '', config.secret)
}

export async function startGitHubLogin(request: Request, config: AuthConfig): Promise<Response> {
  const origin = new URL(request.url).origin
  const now = Math.floor(Date.now() / 1000)
  const payload: OAuthState = { v: 1, purpose: 'oauth', aud: origin, iat: now, exp: now + OAUTH_SECONDS, nonce: nonce(), verifier: nonce() }
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(payload.verifier))))
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', `${origin}/api/auth/github/callback`)
  url.searchParams.set('scope', 'read:user')
  url.searchParams.set('state', payload.nonce)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('allow_signup', 'false')
  return new Response(null, { status: 302, headers: privateHeaders({ Location: url.toString(), 'Set-Cookie': setCookie(OAUTH_COOKIE, await signedCookie(payload, config.secret), OAUTH_SECONDS, 'Lax') }) })
}

export function oauthFailure(request: Request, error: 'denied' | 'failed' | 'unavailable'): Response {
  const url = new URL('/', request.url)
  url.searchParams.set('auth_error', error)
  const headers = privateHeaders({ Location: url.toString() })
  headers.append('Set-Cookie', expiredCookie(OAUTH_COOKIE))
  headers.append('Set-Cookie', expiredCookie(SESSION_COOKIE))
  return new Response(null, { status: 302, headers })
}

async function githubJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('GitHub request failed')
  const body = await response.text()
  if (body.length > 50_000) throw new Error('GitHub response too large')
  const value: unknown = JSON.parse(body)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub response invalid')
  return value as Record<string, unknown>
}

export async function finishGitHubLogin(request: Request, config: AuthConfig, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(request.url)
  const state = await readSigned(request, OAUTH_COOKIE, 'oauth', config)
  if (!state || typeof state.nonce !== 'string' || state.nonce !== url.searchParams.get('state')
      || typeof state.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state.verifier)) return oauthFailure(request, 'failed')
  if (url.searchParams.has('error')) return oauthFailure(request, 'denied')
  const code = url.searchParams.get('code')
  if (!code || code.length > 1024) return oauthFailure(request, 'failed')
  try {
    const tokenData = await githubJson(await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code,
        redirect_uri: `${url.origin}/api/auth/github/callback`, code_verifier: state.verifier }),
    }))
    if (typeof tokenData.access_token !== 'string' || !tokenData.access_token || tokenData.access_token.length > 4096
        || typeof tokenData.token_type !== 'string' || tokenData.token_type.toLowerCase() !== 'bearer' || tokenData.error) return oauthFailure(request, 'failed')
    const user = await githubJson(await fetcher('https://api.github.com/user', {
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'Countwell' },
    }))
    // Identity is checked after every code exchange; login names may change.
    if (!Number.isSafeInteger(user.id) || (user.id as number) <= 0 || String(user.id) !== config.allowedUserId
        || typeof user.login !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(user.login)) return oauthFailure(request, 'denied')
    const now = Math.floor(Date.now() / 1000)
    const session: AuthSession = { v: 1, purpose: 'session', aud: url.origin, iat: now, exp: now + SESSION_SECONDS,
      uid: config.allowedUserId, login: user.login, sid: nonce() }
    const headers = privateHeaders({ Location: `${url.origin}/` })
    headers.append('Set-Cookie', expiredCookie(OAUTH_COOKIE))
    headers.append('Set-Cookie', setCookie(SESSION_COOKIE, await signedCookie(session, config.secret), SESSION_SECONDS, 'Strict'))
    return new Response(null, { status: 302, headers })
  } catch { return oauthFailure(request, 'failed') }
}
