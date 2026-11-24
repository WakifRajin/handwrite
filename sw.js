const VERSION = 'v3';
const SHELL_CACHE = 'handwrite-shell-' + VERSION;
const FONT_CACHE = 'handwrite-fonts-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/geometry.js',
  './js/font.js',
  './js/pwa.js',
  './vendor/opentype.min.js',
  './vendor/clipper.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, FONT_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function swr(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const net = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  });
  if (cached) { net.catch(() => {}); return cached; }
  try { return await net; }
  catch (err) {
    if (fallbackKey) { const f = await cache.match(fallbackKey); if (f) return f; }
    throw err;
  }
}

// App files are ES modules that import each other, so serve them network-first: online you
// always get one consistent version (no new app.js against a stale cached geometry.js);
// offline, or on a network that hangs for 4s, the cached copy is used.
async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (fallbackKey) { const f = await cache.match(fallbackKey); if (f) return f; }
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(swr(req, FONT_CACHE));
  } else if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req, req.mode === 'navigate' ? './index.html' : undefined));
  }
});
