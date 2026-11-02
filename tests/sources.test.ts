import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeSource, SourceError } from '../server/sources'
import type { MaterializedSource } from '../server/sources'
import { loadOfficialLedger } from '../server/engine'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

async function fixtureServer(handler:(request:IncomingMessage,response:ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve) })
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const fixtureFiles:Record<string,string> = {
  'books/main.beancount':'include "../common/accounts.bean"\ninclude "../transactions/2026/*.bean"\n',
  'common/accounts.bean':'2026-01-01 open Assets:Bank\n2026-01-01 open Income:Salary\n',
  'transactions/2026/oct.bean':'2026-10-01 * "Fixture salary"\n  Assets:Bank 100 CNY\n  Income:Salary\n',
}
const hash = (content:string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')
const commitSha = 'a'.repeat(40)
const rootTree = 'b'.repeat(40)

async function githubFixture(options:{truncated?:boolean;unsafe?:string;symlink?:boolean;unauthorized?:boolean;corruptBlob?:boolean} = {}) {
  const calls:{url:string;authorization:string|undefined}[] = []
  const blobs = new Map(Object.entries(fixtureFiles).map(([path,content]) => [hash(content),{path,content}]))
  const directories = new Map([['books','c'.repeat(40)],['common','d'.repeat(40)],['transactions','e'.repeat(40)],['transactions/2026','f'.repeat(40)]])
  const all: {path:string;mode:string;type:string;sha:string;size?:number;url?:string}[] = [
    ...[...directories].map(([path,sha]) => ({path,mode:'040000',type:'tree',sha})),
    ...Object.entries(fixtureFiles).map(([path,content]) => ({path,mode:'100644',type:'blob',sha:hash(content),size:Buffer.byteLength(content),url:'https://example.invalid/must-not-follow'})),
  ]
  if (options.unsafe) all.push({path:options.unsafe,mode:'100644',type:'blob',sha:hash('x'),size:1,url:''})
  if (options.symlink) all.push({path:'link.bean',mode:'120000',type:'blob',sha:hash('x'),size:1,url:''})
  const base = await fixtureServer((request,response) => {
    const url = new URL(request.url!,'http://fixture')
    calls.push({url:request.url!,authorization:request.headers.authorization})
    if (options.unauthorized) { response.writeHead(401); response.end(`private: ${request.headers.authorization}`); return }
    response.setHeader('content-type','application/json')
    if (url.pathname.startsWith('/repos/example/books/commits/')) { response.end(JSON.stringify({sha:commitSha,commit:{tree:{sha:rootTree}}})); return }
    if (url.pathname.startsWith('/repos/example/books/git/trees/')) {
      const sha = url.pathname.split('/').at(-1)
      if (url.search && options.truncated) { response.end(JSON.stringify({tree:[],truncated:true})); return }
      let prefix = ''
      if (sha !== rootTree) prefix = [...directories].find(([,value]) => value === sha)?.[0] + '/'
      const entries = options.truncated ? all.filter(item => item.path.startsWith(prefix) && !item.path.slice(prefix.length).includes('/')).map(item => ({...item,path:item.path.slice(prefix.length)})) : all
      response.end(JSON.stringify({sha,tree:entries,truncated:false})); return
    }
    const blob = blobs.get(url.pathname.split('/').at(-1)!)
    if (url.pathname.includes('/git/blobs/') && blob) { response.setHeader('content-type','application/octet-stream'); response.end(options.corruptBlob ? 'not the committed blob' : blob.content); return }
    response.writeHead(404); response.end('{}')
  })
  return {base,calls}
}

function escapeXml(value:string) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;') }
async function webdavFixture(options:{outside?:boolean;redirect?:string;traversal?:boolean} = {}) {
  const calls:{method:string;url:string;authorization:string|undefined;depth:string|undefined}[] = []
  const files = {...fixtureFiles,'交易 明细/2026/10&11.bean':'; unicode and spaces\n'}
  const base = await fixtureServer((request,response) => {
    calls.push({method:request.method!,url:request.url!,authorization:request.headers.authorization,depth:request.headers.depth as string|undefined})
    if (options.redirect) { response.writeHead(302,{location:options.redirect}); response.end(); return }
    const requestPath = decodeURIComponent(new URL(request.url!,'http://fixture').pathname)
    const root = '/dav/user space/'
    if (!requestPath.startsWith(root)) { response.writeHead(404); response.end(); return }
    const path = requestPath.slice(root.length)
    if (request.method === 'GET' && path in files) { response.end(files[path as keyof typeof files]); return }
    if (request.method !== 'PROPFIND') { response.writeHead(404); response.end(); return }
    const entries = new Map<string,boolean>()
    for (const file of Object.keys(files)) {
      if (!file.startsWith(path)) continue
      const rest = file.slice(path.length)
      const slash = rest.indexOf('/')
      if (slash >= 0) entries.set(path + rest.slice(0,slash+1),true)
      else entries.set(file,false)
    }
    const item = (key:string,directory:boolean) => {
      const href = root.split('/').map(encodeURIComponent).join('/') + key.split('/').map(encodeURIComponent).join('/')
      return `<D:response><D:href>${escapeXml(href)}</D:href><D:propstat><D:prop><D:resourcetype>${directory?'<D:collection/>':''}</D:resourcetype>${directory?'':`<D:getcontentlength>${Buffer.byteLength(files[key as keyof typeof files])}</D:getcontentlength>`}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
    }
    const malicious = options.outside ? '<D:response><D:href>https://example.invalid/steal.bean</D:href></D:response>' : options.traversal ? '<D:response><D:href>/dav/user%20space/%2e%2e/escape.bean</D:href></D:response>' : ''
    response.writeHead(207,{'content-type':'application/xml'})
    response.end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${item(path,true)}${malicious}${[...entries].map(([key,directory]) => item(key,directory)).join('')}</D:multistatus>`)
  })
  return {base,url:`${base}/dav/user%20space/`,calls}
}

describe('read-only local source', () => {
  it('keeps the real multi-directory structure and never removes local files on cleanup',async () => {
    const root = await mkdtemp(join(tmpdir(),'countwell-local-test-'))
    cleanup.push(() => rm(root,{recursive:true,force:true}))
    for (const [path,content] of Object.entries(fixtureFiles)) { await mkdir(join(root,path,'..'),{recursive:true}); await writeFile(join(root,path),content) }
    const source = await materializeSource({type:'local',entryPath:join(root,'books/main.beancount')})
    expect(source.entryPath).toBe(await realpath(join(root,'books/main.beancount')))
    expect(await readFile(join(source.rootPath,'../common/accounts.bean'),'utf8')).toContain('Assets:Bank')
    await source.cleanup()
    await expect(access(source.entryPath)).resolves.toBeUndefined()
  })
  it('returns a safe error for a missing entry without echoing the supplied path',async () => {
    await expect(materializeSource({type:'local',entryPath:'/no/such/private-account.beancount'})).rejects.toMatchObject({code:'missing_entry'})
  })
})

describe('GitHub fixed-commit materialisation', () => {
  it('downloads the full tree with authentication and preserves sibling/nested include directories',async () => {
    const fixture = await githubFixture()
    const source = await materializeSource({type:'github',repository:'example/books',ref:'ledger/2026',entryPath:'books/main.beancount',token:'fixture-read-token'},{githubApiBase:fixture.base})
    cleanup.push(source.cleanup)
    expect(source.revision).toBe(commitSha)
    expect(source.files).toEqual(Object.keys(fixtureFiles).sort())
    for (const [path,content] of Object.entries(fixtureFiles)) expect(await readFile(join(source.rootPath,path),'utf8')).toBe(content)
    expect(fixture.calls[0].url).toContain('/commits/ledger%2F2026')
    expect(fixture.calls.slice(1).every(call => !call.url.includes('/commits/') && call.authorization === 'Bearer fixture-read-token')).toBe(true)
    await source.cleanup()
    await expect(access(source.rootPath)).rejects.toThrow()
  })
  it('walks non-recursive trees instead of accepting a truncated GitHub response',async () => {
    const fixture = await githubFixture({truncated:true})
    const source = await materializeSource({type:'github',repository:'example/books',entryPath:'books/main.beancount'},{githubApiBase:fixture.base})
    cleanup.push(source.cleanup)
    expect(source.files).toEqual(Object.keys(fixtureFiles).sort())
    expect(fixture.calls.filter(call => call.url.includes('/git/trees/')).length).toBeGreaterThan(4)
  })
  it.each([{unsafe:'../escape.bean'},{symlink:true}])('rejects unsafe repository entries (%j)',async options => {
    const fixture = await githubFixture(options)
    await expect(materializeSource({type:'github',repository:'example/books',entryPath:'books/main.beancount'},{githubApiBase:fixture.base})).rejects.toBeInstanceOf(SourceError)
  })
  it('does not echo credentials or upstream response bodies in an authentication error',async () => {
    const fixture = await githubFixture({unauthorized:true})
    const error = await materializeSource({type:'github',repository:'example/books',entryPath:'books/main.beancount',token:'fixture-secret-token'},{githubApiBase:fixture.base}).catch(error => error)
    expect(error.code).toBe('unauthorized')
    expect(String(error)).not.toContain('fixture-secret-token')
  })
  it('rejects blob bytes that do not match the pinned tree object',async () => {
    const fixture = await githubFixture({corruptBlob:true})
    await expect(materializeSource({type:'github',repository:'example/books',entryPath:'books/main.beancount'},{githubApiBase:fixture.base})).rejects.toMatchObject({code:'invalid_response'})
  })
})

describe('recursive WebDAV materialisation', () => {
  it('uses Depth:1 per directory, preserves UTF-8 paths, and sends Basic authentication only to the configured server',async () => {
    const fixture = await webdavFixture()
    const source = await materializeSource({type:'webdav',url:fixture.url,entryPath:'books/main.beancount',username:'fixture-user',password:'fixture-password'})
    cleanup.push(source.cleanup)
    expect(source.files).toContain('交易 明细/2026/10&11.bean')
    expect(await readFile(join(source.rootPath,'transactions/2026/oct.bean'),'utf8')).toContain('Fixture salary')
    expect(fixture.calls.filter(call => call.method === 'PROPFIND').every(call => call.depth === '1')).toBe(true)
    expect(fixture.calls.every(call => call.authorization === `Basic ${Buffer.from('fixture-user:fixture-password').toString('base64')}`)).toBe(true)
  })
  it.each([{outside:true},{traversal:true}])('rejects hrefs outside the selected root (%j)',async options => {
    const fixture = await webdavFixture(options)
    await expect(materializeSource({type:'webdav',url:fixture.url,entryPath:'books/main.beancount'})).rejects.toMatchObject({code:'unsafe_path'})
    expect(fixture.calls.filter(call => call.method === 'GET')).toHaveLength(0)
  })
  it('never follows a credential-bearing redirect to another server',async () => {
    let outsideRequests = 0
    const outside = await fixtureServer((_request,response) => { outsideRequests++; response.end('not allowed') })
    const fixture = await webdavFixture({redirect:`${outside}/leak`})
    await expect(materializeSource({type:'webdav',url:fixture.url,entryPath:'books/main.beancount',token:'fixture-only-secret'})).rejects.toMatchObject({code:'unsafe_redirect'})
    expect(outsideRequests).toBe(0)
  })
  it('enforces file-size and total-size limits before returning a partial source',async () => {
    const fixture = await webdavFixture()
    await expect(materializeSource({type:'webdav',url:fixture.url,entryPath:'books/main.beancount'},{limits:{maxFileBytes:8}})).rejects.toMatchObject({code:'limit_exceeded'})
    await expect(materializeSource({type:'webdav',url:fixture.url,entryPath:'books/main.beancount'},{limits:{maxBytes:8}})).rejects.toMatchObject({code:'limit_exceeded'})
  })
  it('aborts a data source that never answers within the configured timeout',async () => {
    const url = await fixtureServer(() => {})
    await expect(materializeSource({type:'webdav',url,entryPath:'main.beancount'},{limits:{timeoutMs:20}})).rejects.toMatchObject({code:'timeout'})
  })
})

describe('remote materialisation through the official Beancount engine', () => {
  async function assertOfficialLoad(source:MaterializedSource) {
    cleanup.push(source.cleanup)
    const local = join(process.cwd(),'.venv/bin/python')
    const temporary = '/private/tmp/countwell-project-review-20261101/bin/python'
    const pythonPath = process.env.COUNTWELL_PYTHON || (existsSync(local) ? local : existsSync(temporary) ? temporary : 'python3')
    const ledger = await loadOfficialLedger(source.entryPath,{pythonPath,sourceRoot:source.rootPath})
    expect(ledger.engine.name).toBe('beancount')
    expect(ledger.files.map(file => file.path).sort()).toEqual(Object.keys(fixtureFiles).sort())
    expect(ledger.transactions).toHaveLength(1)
    expect(ledger.transactions[0].postings).toEqual(expect.arrayContaining([
      expect.objectContaining({account:'Assets:Bank',amount:'100',currency:'CNY'}),
      expect.objectContaining({account:'Income:Salary',amount:'-100',currency:'CNY'}),
    ]))
  }
  it('loads GitHub sibling directories and nested globs, including official amount interpolation',async () => {
    const fixture = await githubFixture()
    await assertOfficialLoad(await materializeSource({type:'github',repository:'example/books',entryPath:'books/main.beancount'},{githubApiBase:fixture.base}))
  })
  it('loads the same multi-directory include tree downloaded recursively from WebDAV',async () => {
    const fixture = await webdavFixture()
    await assertOfficialLoad(await materializeSource({type:'webdav',url:fixture.url,entryPath:'books/main.beancount'}))
  })
})
