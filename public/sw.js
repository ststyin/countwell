/* Only the public demo application shell is cached. Never cache ledger API data. */
// The production build replaces this value with a hash of its application assets.
const SHELL_VERSION = 'v1';
const CACHE_PREFIX = 'countwell-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${SHELL_VERSION}`;
const PUBLIC_SHELL = [
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
];

function canCache(response) {
  return response.ok && response.type === 'basic' && !response.redirected
    && !/\bno-store\b/i.test(response.headers.get('cache-control') || '');
}

function isStaticAsset(url) {
  return PUBLIC_SHELL.includes(url.pathname)
    || (/^\/assets\/[^/]+\.(?:js|css|woff2?|svg|png|webp)$/i.test(url.pathname));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const index = await fetch(new Request('/index.html', { cache: 'reload' }));
    if (!canCache(index) || !/text\/html/i.test(index.headers.get('content-type') || '')) {
      throw new Error('The Countwell application shell could not be cached.');
    }
    const html = await index.clone().text();
    const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
      .map(match => new URL(match[1], self.location.origin))
      .filter(url => url.origin === self.location.origin && !url.search && isStaticAsset(url))
      .map(url => url.pathname);
    await Promise.all([...new Set([...PUBLIC_SHELL, ...assets])].map(async path => {
      const response = await fetch(new Request(path, { cache: 'reload' }));
      if (!canCache(response)) throw new Error('A public application asset could not be cached.');
      await cache.put(path, response);
    }));
    await cache.put('/', index.clone());
    await cache.put('/index.html', index);
  })());
  // Existing pages choose when to apply an update; do not skip waiting here.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search
      || request.headers.has('authorization')) return;

  if (request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      // Publish one complete precached build at a time. Fetching a newer HTML
      // here could replace the shell before its referenced assets are available.
      const shell = await cache.match('/');
      if (shell) return shell;
      try {
        // Recovery when browser storage was evicted: let the network open the
        // app, but never mix an individually fetched HTML into this build cache.
        return await fetch(request);
      } catch {
        return await cache.match('/offline.html')
          || new Response('Countwell 暂时离线，请连接网络后重试。', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
      }
    })());
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (canCache(response)) await cache.put(request, response.clone());
      return response;
    })());
  }
});
