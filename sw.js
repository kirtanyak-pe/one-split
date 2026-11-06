// Caches the app shell so One Split opens offline. API calls (the Worker) are never cached here: the app has its
// own read cache and shows an "offline" state when a request fails.
const CACHE = 'one-split-shell-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.protocol.startsWith('chrome')) return
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return // Worker/API: network only
  if (url.pathname.endsWith('/version.json')) return // update check: always the network
  if (req.mode === 'navigate') {
    // Network first for the page (so updates arrive), shell from cache when offline.
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return r }).catch(() => caches.match('./index.html')))
    return
  }
  // Hashed build assets and fonts: cache first, fill on miss.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) } return r })))
})
