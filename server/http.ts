import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { SourceManager } from './manager'
import { validateConfig } from './config'

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

export async function createCountwellApp(options: { manager: SourceManager; dev?: boolean; distDirectory?: string }) {
  const csrf = randomBytes(32).toString('base64url')
  const dist = resolve(options.distDirectory ?? 'dist')
  const vite = options.dev ? await (await import('vite')).createServer({ server: {
    middlewareMode: true,
    fs: { allow: ['src', 'public', 'node_modules', 'index.html'].map(path => resolve(path)), deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.countwell/**', '**/.venv/**'] },
  }, appType: 'spa' }) : null

  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' })
    res.end(JSON.stringify(value))
  }

  function trusted(req: IncomingMessage) {
    const port = (server.address() as AddressInfo | null)?.port
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    const host = req.headers.host
    return !!host && hosts.includes(host) && !Array.isArray(req.headers.origin)
      && (!req.headers.origin || req.headers.origin === `http://${host}`)
      && req.headers['sec-fetch-site'] !== 'cross-site'
  }

  function authorized(req: IncomingMessage) {
    const token = req.headers['x-countwell-token']
    if (typeof token !== 'string') return false
    const supplied = Buffer.from(token), expected = Buffer.from(csrf)
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  }

  async function body(req: IncomingMessage) {
    let text = ''
    for await (const chunk of req) {
      text += chunk
      if (Buffer.byteLength(text) > 65536) throw new Error('数据源配置过长。')
    }
    try { return JSON.parse(text) as unknown } catch { throw new Error('请提交有效的 JSON 数据源配置。') }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let decoded: string
    try { decoded = decodeURIComponent(url.pathname) } catch { res.writeHead(400); res.end(); return }
    if (decoded.split(/[\\/]/).some(part => ['.countwell', '.venv', '.git'].includes(part))) { res.writeHead(404); res.end(); return }
    if (url.pathname.startsWith('/api/')) {
      if (!trusted(req)) { req.resume(); json(res, 403, { error: { message: '只允许本机同源访问账本服务。' } }); return }
      if (req.method === 'GET' && url.pathname === '/api/session') { json(res, 200, { csrf, apiVersion: 1 }); return }
      if (req.method === 'GET' && url.pathname === '/api/ledger/status') { json(res, 200, options.manager.getStatus()); return }
      // Both reads and writes containing financial data require the session token.
      if (!authorized(req)) { req.resume(); json(res, 403, { error: { message: '账本会话已过期，请刷新后重试。' } }); return }
      try {
        if (req.method === 'GET' && url.pathname === '/api/ledger/snapshot') {
          const snapshot = options.manager.getSnapshot()
          json(res, snapshot ? 200 : 409, snapshot ?? { error: { message: '尚未成功加载真实账本。' } }); return
        }
        if (req.method === 'POST' && url.pathname === '/api/ledger/connect') { json(res, 200, await options.manager.connect(validateConfig(await body(req)))); return }
        if (req.method === 'POST' && url.pathname === '/api/ledger/reload') { req.resume(); json(res, 200, await options.manager.reload()); return }
        if (req.method === 'DELETE' && url.pathname === '/api/ledger/source') { req.resume(); json(res, 200, await options.manager.disconnect()); return }
        req.resume(); json(res, 404, { error: { message: '接口不存在。' } })
      } catch (error) {
        const value = error as { message?: string; code?: string; diagnostics?: unknown }
        json(res, 400, { error: { message: value.message ?? '无法加载账本。', code: value.code, diagnostics: value.diagnostics }, status: options.manager.getStatus() })
      }
      return
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { req.resume(); res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return }
    if (vite) { vite.middlewares(req, res); return }
    let pathname: string
    try { pathname = decodeURIComponent(url.pathname) } catch { res.writeHead(400); res.end(); return }
    let file = resolve(dist, '.' + pathname)
    if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(404); res.end(); return }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html')
      const data = await readFile(file)
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch {
      if (!extname(pathname)) {
        try { const data = await readFile(resolve(dist, 'index.html')); res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : data); return } catch { /* Build has not run yet. */ }
      }
      res.writeHead(404); res.end('页面不存在。请先运行 npm run build。')
    }
  }

  const server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) json(res, 500, { error: { message: '请求无法处理。' } }); else res.end() }) })
  server.requestTimeout = 180000
  return { server, async close() { await vite?.close(); if (server.listening) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } } }
}
