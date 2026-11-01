import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const origin = 'https://countwell.test';
type RequestInput = Request | string;

function request(input: RequestInput): Request {
  return typeof input === 'string' ? new Request(new URL(input, origin)) : input.clone();
}

/** Cache matching includes the stored response's Vary headers, as browsers do. */
class VaryAwareCache {
  private entries: { request: Request; response: Response }[] = [];

  async put(input: RequestInput, response: Response) {
    const storedRequest = request(input);
    if (response.headers.get('vary')?.trim() === '*') throw new TypeError('Vary: * cannot be cached.');
    this.entries = this.entries.filter(entry => entry.request.url !== storedRequest.url);
    this.entries.push({ request: storedRequest, response: response.clone() });
  }

  async match(input: RequestInput, options: CacheQueryOptions = {}): Promise<Response | undefined> {
    const incoming = request(input);
    for (const entry of this.entries) {
      if (!options.ignoreMethod && incoming.method !== entry.request.method) continue;
      const storedUrl = new URL(entry.request.url);
      const incomingUrl = new URL(incoming.url);
      if (options.ignoreSearch) { storedUrl.search = ''; incomingUrl.search = ''; }
      if (storedUrl.href !== incomingUrl.href) continue;
      if (!options.ignoreVary) {
        const vary = (entry.response.headers.get('vary') ?? '').split(',').map(name => name.trim()).filter(Boolean);
        if (vary.some(name => name === '*' || entry.request.headers.get(name) !== incoming.headers.get(name))) continue;
      }
      return entry.response.clone();
    }
    return undefined;
  }
}

function sameOriginResponse(body: string, contentType = 'text/plain'): Response {
  const response = new Response(body, {
    headers: { 'Content-Type': contentType, Vary: 'Origin' },
  });
  // Node's Response constructor defaults to "default"; a fetched same-origin
  // browser response is "basic", which the service worker correctly requires.
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

const html = `<!doctype html><html><head><title>Countwell</title>
<script type="module" crossorigin src="/assets/index-test.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-test.css">
</head><body><div id="root"></div></body></html>`;

function serviceWorkerHarness() {
  const handlers = new Map<string, (event: unknown) => void>();
  const cachesByName = new Map<string, VaryAwareCache>();
  let online = true;
  const networkRequests: Request[] = [];
  class BrowserRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, origin) : input, init);
    }
  }
  const workerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  runInNewContext(workerSource, {
    self: {
      location: { origin },
      addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
    },
    caches: {
      open: async (name: string) => {
        if (!cachesByName.has(name)) cachesByName.set(name, new VaryAwareCache());
        return cachesByName.get(name)!;
      },
      keys: async () => [...cachesByName.keys()],
      delete: async (name: string) => cachesByName.delete(name),
    },
    Request: BrowserRequest,
    Response,
    URL,
    fetch: async (input: RequestInput) => {
      const incoming = request(input);
      networkRequests.push(incoming);
      if (!online) throw new TypeError('Network unavailable');
      const pathname = new URL(incoming.url).pathname;
      if (pathname === '/index.html') return sameOriginResponse(html, 'text/html');
      if (pathname.endsWith('.js')) return sameOriginResponse('window.countwellLoaded = true;', 'application/javascript');
      if (pathname.endsWith('.css')) return sameOriginResponse('body { color: gold; }', 'text/css');
      return sameOriginResponse('public fixture asset');
    },
  });

  return {
    networkRequests,
    goOffline() { online = false; },
    async install() {
      let lifetime: Promise<unknown> | undefined;
      handlers.get('install')!({ waitUntil(work: Promise<unknown>) { lifetime = work; } });
      await lifetime;
    },
    async handle(incoming: Request): Promise<Response | undefined> {
      let response: Promise<Response> | undefined;
      handlers.get('fetch')!({ request: incoming, respondWith(work: Promise<Response>) { response = work; } });
      return response;
    },
  };
}

describe('browser Cache API Vary matching', () => {
  it('distinguishes an Origin-bearing module request from the Origin-less precache key', async () => {
    const cache = new VaryAwareCache();
    await cache.put('/assets/app.js', sameOriginResponse('module source'));
    expect(await cache.match('/assets/app.js')).toBeInstanceOf(Response);
    const moduleRequest = new Request(`${origin}/assets/app.js`, { headers: { Origin: origin } });
    expect(await cache.match(moduleRequest)).toBeUndefined();
    expect(await cache.match(moduleRequest, { ignoreVary: true })).toBeInstanceOf(Response);
  });

  it('matches equal Vary request headers and rejects different values', async () => {
    const cache = new VaryAwareCache();
    await cache.put(new Request(`${origin}/assets/app.js`, { headers: { Origin: origin } }), sameOriginResponse('module source'));
    expect(await cache.match(new Request(`${origin}/assets/app.js`, { headers: { Origin: origin } }))).toBeInstanceOf(Response);
    expect(await cache.match(new Request(`${origin}/assets/app.js`, { headers: { Origin: 'https://other.test' } }))).toBeUndefined();
  });
});

describe('production service worker offline application shell', () => {
  it.each(['/assets/index-test.js', '/assets/index-test.css'])('precaches %s for a request without Origin', async pathname => {
    const harness = serviceWorkerHarness();
    await harness.install();
    harness.goOffline();
    const response = await harness.handle(new Request(origin + pathname));
    expect(response?.ok).toBe(true);
  });

  it.each([
    ['/assets/index-test.js', 'window.countwellLoaded'],
    ['/assets/index-test.css', 'color: gold'],
  ])('loads HTML and crossorigin %s offline with Vary: Origin responses', async (pathname, expected) => {
    const harness = serviceWorkerHarness();
    await harness.install();
    harness.goOffline();
    const navigation = new Request(origin + '/');
    Object.defineProperty(navigation, 'mode', { value: 'navigate' });
    const shell = await harness.handle(navigation);
    expect(await shell?.text()).toContain('<title>Countwell</title>');

    // A successful cached HTML alone is insufficient: the module and CSS
    // requested with crossorigin must also load without the preview server.
    const crossoriginRequest = new Request(origin + pathname, { mode: 'cors', headers: { Origin: origin } });
    const before = harness.networkRequests.length;
    const response = await harness.handle(crossoriginRequest);
    expect(await response?.text()).toContain(expected);
    expect(harness.networkRequests).toHaveLength(before);
  });

  it('does not intercept JSON, API, queries or authenticated requests while offline', async () => {
    const harness = serviceWorkerHarness();
    await harness.install();
    harness.goOffline();
    for (const incoming of [
      new Request(`${origin}/api/overview`),
      new Request(`${origin}/ledger.json`),
      new Request(`${origin}/assets/index-test.js?token=private`),
      new Request(`${origin}/assets/index-test.js`, { headers: { Authorization: 'Bearer private' } }),
    ]) expect(await harness.handle(incoming)).toBeUndefined();
  });
});
